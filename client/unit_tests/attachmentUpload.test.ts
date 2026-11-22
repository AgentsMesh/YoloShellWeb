import { expect, spyOn, test } from "bun:test";
import { uploadAttachment, type AttachmentChunk } from "../../sdk/src/attachmentUpload";
import { fileUri, terminalReference } from "../browser/filePaste";

test("chunks a non-text file with a stable ID and publishes the destination path at EOF", async () => {
  const source = new Uint8Array(165_729);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  const chunks: AttachmentChunk[] = [];
  const path = "/tmp/画像 can't #1.png";
  const result = await uploadAttachment(new Blob([source]), "画像 can't #1.png", async (chunk) => {
    chunks.push(chunk);
    return { upload_id: chunk.upload_id, next_offset: chunk.offset + atob(chunk.data).length, path: chunk.eof ? path : null };
  });
  expect(chunks.map((c) => c.offset)).toEqual([0, 65536, 131072]);
  expect(new Set(chunks.map((c) => c.upload_id)).size).toBe(1);
  expect(Buffer.concat(chunks.map((c) => Buffer.from(c.data, "base64"))).equals(Buffer.from(source))).toBe(true);
  expect(result).toBe(path);
  expect(decodeURIComponent(new URL(fileUri(result)).pathname)).toBe(path);
  expect(terminalReference(result)).toBe("'/tmp/画像 can'\\''t #1.png'");
});

test("sends a final frame for an empty file and rejects receipts for another upload", async () => {
  const empty = new Blob([]);
  expect(await uploadAttachment(empty, "empty", async (chunk) => {
    expect(chunk).toMatchObject({ data: "", offset: 0, eof: true });
    return { upload_id: chunk.upload_id, path: "/tmp/empty", next_offset: 0 };
  })).toBe("/tmp/empty");
  await expect(uploadAttachment(empty, "empty", async () => ({
    upload_id: "other", next_offset: 0, path: "/tmp/wrong",
  }))).rejects.toThrow("Mismatched");
});

test("browser paste shortcuts reach the native clipboard, including macOS Command-V", async () => {
  const { browserPasteKey } = await import("../browser/terminalFiles");
  const v = (mods: Record<string, boolean>) => ({ key: "v", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent;
  expect(browserPasteKey(v({ ctrlKey: true }), false)).toBe(true);
  expect(browserPasteKey(v({ metaKey: true }), true)).toBe(true);
  expect(browserPasteKey(v({ ctrlKey: true }), true)).toBe(false);
  expect(browserPasteKey(v({ ctrlKey: true, altKey: true }), false)).toBe(false);
});

test("one clipboard gesture with several files yields separate xterm pastes for each quoted path and separator", async () => {
  const { api } = await import("../browser/api");
  const { bindTerminalFiles } = await import("../browser/terminalFiles");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const button = new EventTarget();
  Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: () => button } });
  const stage = spyOn(api, "stageAttachment").mockImplementation(async (body) => {
    const chunk = body as AttachmentChunk;
    return { upload_id: chunk.upload_id, next_offset: 1, path: "/tmp/" + chunk.name };
  });
  const session = new AbortController();
  try {
    const host = new EventTarget() as HTMLElement;
    const gestures: import("../browser/terminalInput").PasteSource[] = [];
    bindTerminalFiles(host, { attachCustomKeyEventHandler() {} }, { machine: "m", terminal_id: "t", runtime_epoch: "e" },
      (source) => gestures.push(source), session.signal);
    const event = new Event("paste", { cancelable: true });
    const files = ["one.png", "two words.png"].map((name) => new File(["x"], name));
    Object.defineProperty(event, "clipboardData", { value: { files, items: [] } });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(gestures).toHaveLength(1);
    const [prepare] = gestures;
    if (typeof prepare !== "function") throw new Error("Expected a deferred upload");
    expect(await prepare(session.signal, () => {})).toEqual(["/tmp/one.png", " ", "'/tmp/two words.png'"]);
  } finally {
    session.abort();
    stage.mockRestore();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
