import { expect, mock, spyOn, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { TerminalAttachment, type AttachmentEvent } from "../../sdk/src/terminalAttachment";
import { HubError } from "../../sdk/src/hubError";
import { InputQueue } from "../../sdk/src/inputQueue";
import { TerminalSession } from "../../sdk/src/terminalSession";
import * as hub from "../server/hub";
import { TerminalActor } from "../server/terminalActor";
import { openSeed } from "../server/terminalSeed";
import { TERMINAL_DETACHED } from "../shared/protocol";

const target = { address: { hub_id: "hub", terminal_id: "terminal" }, runtime_epoch: "epoch" };

function socket() {
  const events: string[] = [];
  const leases: { controlled: boolean; controller: boolean }[] = [];
  const live = Promise.withResolvers<void>();
  const ws = {
    readyState: 1,
    send(value: string | Uint8Array) {
      if (typeof value !== "string") return;
      const frame = JSON.parse(value);
      const { type } = frame;
      events.push(type);
      if (type === "live") live.resolve();
      if (type === "lease") leases.push(frame);
    },
    close(code: number, reason: string) {
      events.push(`close ${code} ${reason}`);
    },
  } as unknown as ServerWebSocket<unknown>;
  return { ws, events, leases, live: live.promise };
}

for (const ending of ["exited", "unreachable", "error"] as const) {
  test(`the actor releases both WebSocket roles and its Hub stream on ${ending}`, async () => {
    const event = Promise.withResolvers<AttachmentEvent>();
    const upstream = {
      takeInitial: () => ({ history: { cols: 80, rows: 24, data: Uint8Array.of(1, 2) } }),
      nextEvent: () => event.promise,
      close: mock(() => {}),
    };
    using endpoint = spyOn(hub, "hubEndpoint").mockReturnValue({ socket: "/test", hubId: "hub" });
    using open = spyOn(TerminalAttachment, "open").mockResolvedValue(upstream as unknown as TerminalAttachment);
    const closed = Promise.withResolvers<void>();
    const actor = new TerminalActor(target, closed.resolve);
    const output = socket();
    const control = socket();
    actor.attachOutput(output.ws);
    actor.attachControl(control.ws, "tab");
    await output.live;
    expect(actor.history(100)?.data).toEqual(Uint8Array.of(1, 2));

    if (ending === "exited") event.resolve({ event: "exited", code: 0, signal: null });
    else if (ending === "unreachable") event.resolve({ event: "unreachable" });
    else event.reject(new Error("upstream failed"));
    await closed.promise;
    const close = `close 1000 ${TERMINAL_DETACHED}`;
    expect(output.events.slice(-2)).toEqual([ending === "exited" ? "exit" : ending, close]);
    expect(control.events.at(-1)).toBe(close);
    actor.close();
    expect(upstream.close).toHaveBeenCalledTimes(1);
    expect(actor.history(100)).toBeNull();
  });
}

test("a missing seed closes the newly opened upstream attachment", async () => {
  const upstream = { takeInitial: () => null, close: mock(() => {}) };
  using endpoint = spyOn(hub, "hubEndpoint").mockReturnValue({ socket: "/test", hubId: "hub" });
  using open = spyOn(TerminalAttachment, "open").mockResolvedValue(upstream as unknown as TerminalAttachment);
  await expect(openSeed(target)).rejects.toThrow("seed is missing");
  expect(upstream.close).toHaveBeenCalledTimes(1);
});

function writer() {
  return {
    state: "observing",
    connected: true,
    observe: async () => null,
    async acquire() { this.state = "controlled"; },
    close: mock(async () => {}),
    discardInput: () => false,
  };
}

for (const takeover of [false, true]) {
  test(`a departing tab cannot retain or revoke a writer lease (takeover: ${takeover})`, async () => {
    const pending = Promise.withResolvers<TerminalSession>();
    const connecting = Promise.withResolvers<void>();
    const first = writer();
    const second = writer();
    using endpoint = spyOn(hub, "hubEndpoint").mockReturnValue({ socket: "/test", hubId: "hub" });
    using open = spyOn(TerminalSession, "open")
      .mockImplementationOnce(() => { connecting.resolve(); return pending.promise; })
      .mockResolvedValue(second as unknown as TerminalSession);
    const actor = new TerminalActor(target, () => {});
    const a = socket();
    const b = socket();
    actor.attachControl(a.ws, "a");
    actor.attachControl(b.ws, "b");
    actor.message(a.ws, "a", '{"type":"take"}');
    await connecting.promise;
    if (takeover) actor.message(b.ws, "b", '{"type":"take"}');
    actor.detachControl(a.ws, "a");
    pending.resolve(first as unknown as TerminalSession);
    // A prompt from an observing tab waits for earlier lease changes to settle.
    await actor.releaseForPrompt("observer");
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(b.leases.at(-1)).toMatchObject({ controlled: takeover, controller: takeover });
    expect(second.close).toHaveBeenCalledTimes(0);
    actor.close();
  });
}

for (const outcome of ["acknowledged", "invalid_lease", "outcome_unknown"]) {
  test("a tab handoff fences queued input when the old block returns " + outcome, async () => {
    const oldAck = Promise.withResolvers<void>();
    const newWrite = Promise.withResolvers<void>();
    const bytes: number[][] = [];
    const errors: Error[] = [];
    const lease = { state: "controlled", currentGrant: { generation: 1 }, acquire: mock(async () => {}) };
    const hubInput = { async input(request: { data: number[] }) {
      bytes.push(request.data);
      if (bytes.length === 1) await oldAck.promise;
      else newWrite.resolve();
    } };
    const queue = new InputQueue(hubInput as any, {} as any, lease as any, (error) => errors.push(error));
    const session = {
      ...writer(), state: "controlled",
      enqueue: (data: Uint8Array) => queue.enqueue(data), discardInput: () => queue.discardPending(),
    };
    using endpoint = spyOn(hub, "hubEndpoint").mockReturnValue({ socket: "/test", hubId: "hub" });
    using open = spyOn(TerminalSession, "open").mockResolvedValue(session as unknown as TerminalSession);
    const actor = new TerminalActor(target, () => {});
    const first = socket(), second = socket();
    try {
      actor.attachControl(first.ws, "first");
      actor.attachControl(second.ws, "second");
      actor.message(first.ws, "first", '{"type":"take"}');
      await actor.releaseForPrompt("observer");
      actor.message(first.ws, "first", new Uint8Array(65_537).fill(97));
      actor.message(first.ws, "first", Uint8Array.of(13));
      actor.message(second.ws, "second", '{"type":"take"}');
      await actor.releaseForPrompt("observer");
      actor.message(first.ws, "first", Uint8Array.of(99));
      actor.message(second.ws, "second", Uint8Array.of(98));
      expect(bytes).toHaveLength(1);
      expect(first.events).toContain("error");
      expect(second.events).not.toContain("error");
      if (outcome === "acknowledged") oldAck.resolve();
      else oldAck.reject(new HubError(-32000, outcome, { kind: "hub", code: outcome }));
      await newWrite.promise;
      expect(bytes).toEqual([Array(8192).fill(97), [98]]);
      expect(lease.acquire).toHaveBeenCalledTimes(0);
      expect(errors).toEqual([]);
    } finally { actor.close(); }
  });
}
