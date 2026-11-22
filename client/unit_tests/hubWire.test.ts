import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubTimeoutError, HubWire } from "../../sdk/src/hubWire";

type Request = { id: number; method: string; params: { text?: string } };

async function localHub() {
  const directory = mkdtempSync(join(tmpdir(), "yolo-wire-"));
  const path = join(directory, "rpc");
  const accepted = Promise.withResolvers<Socket>();
  const server = createServer((socket) => {
    socket.pause();
    socket.on("error", () => {});
    accepted.resolve(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  const wire = await HubWire.connect({ socket: path, hubId: "test" });
  const socket = await accepted.promise;
  const requests: Request[] = [];
  const invalid: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  function read(receive: (request: Request) => void) {
    socket.on("data", (chunk: Buffer) => {
      try {
        buffer += decoder.decode(chunk, { stream: true });
        let end = buffer.indexOf("\n");
        while (end >= 0) {
          const request = JSON.parse(buffer.slice(0, end)) as Request;
          buffer = buffer.slice(end + 1);
          requests.push(request);
          receive(request);
          end = buffer.indexOf("\n");
        }
      } catch (error) {
        invalid.push(String(error));
        socket.destroy();
      }
    });
    socket.resume();
  }
  function reply(request: Request) {
    socket.write(JSON.stringify({ id: request.id, result: request.method }) + "\n");
  }
  function close() {
    wire.close();
    socket.destroy();
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
  return { wire, requests, invalid, read, reply, close };
}

const bigText = "雪🌲".repeat(150_000);

test("short Unix writes resume at UTF-8 byte offsets and multiplexed JSON lines stay ordered", async () => {
  const h = await localHub();
  try {
    const first = h.wire.call("input", { text: bigText });
    const second = h.wire.call("observe", {});
    h.read(() => {
      if (h.requests.length === 2) h.requests.toReversed().forEach(h.reply);
    });
    expect(await Promise.all([first, second])).toEqual(["input", "observe"]);
    expect(h.invalid).toEqual([]);
    expect(h.requests.map((request) => request.method)).toEqual(["input", "observe"]);
    expect(h.requests[0].params.text).toBe(bigText);
  } finally { h.close(); }
});

test("an unsent expired request leaves no bytes between neighboring requests", async () => {
  const h = await localHub();
  try {
    const first = h.wire.call("first", { text: bigText });
    const expires = h.wire.call("expired", {}, 15);
    const last = h.wire.call("last", {});
    await expect(expires).rejects.toBeInstanceOf(HubTimeoutError);
    h.read(h.reply);
    expect(await Promise.all([first, last])).toEqual(["first", "last"]);
    expect(h.requests.map((request) => request.method)).toEqual(["first", "last"]);
    expect(h.invalid).toEqual([]);
  } finally { h.close(); }
});

test("timing out mid-frame closes the stream and rejects all queued calls", async () => {
  const h = await localHub();
  try {
    const replies = await Promise.allSettled([
      h.wire.call("partial", { text: bigText }, 15),
      h.wire.call("queued", {}),
    ]);
    expect(replies[0]).toMatchObject({ status: "rejected", reason: expect.any(HubTimeoutError) });
    expect(replies[1]).toMatchObject({ status: "rejected", reason: expect.any(Error) });
    expect(h.wire.connected).toBe(false);
    await expect(h.wire.call("later", {})).rejects.toThrow("Hub is not connected");
  } finally { h.close(); }
});

test("a sent mutation can time out independently and its late reply does not affect the next call", async () => {
  const h = await localHub();
  try {
    const seen = Promise.withResolvers<void>();
    h.read((request) => {
      if (request.method === "mutation") seen.resolve();
      if (request.method === "next") h.reply(request);
    });
    await Promise.all([
      seen.promise,
      expect(h.wire.call("mutation", {}, 30)).rejects.toBeInstanceOf(HubTimeoutError),
    ]);
    expect(h.requests.map((request) => request.method)).toEqual(["mutation"]);
    h.reply(h.requests[0]);
    expect(await h.wire.call("next", {})).toBe("next");
    expect(h.requests.map((request) => request.method)).toEqual(["mutation", "next"]);
  } finally { h.close(); }
});
