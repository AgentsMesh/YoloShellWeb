import { expect, test } from "bun:test";
import { TerminalControl } from "../browser/terminalControl";
import { TerminalInputBinding } from "../browser/terminalInputBinding";
import type { PasteSource } from "../browser/terminalInput";
import type { XtermKey } from "../browser/terminalXterm";
import type { WireLeaseState } from "../shared/protocol";

const bracket = (value: string) => "\x1b[200~" + value + "\x1b[201~";
const noop = () => {};

function view(state: WireLeaseState = "controlled") {
  const writes: string[] = [], notices: string[] = [];
  let takes = 0;
  const control = new TerminalControl({
    sendTake: () => { takes++; }, sendRelease: noop,
    sendInput: (bytes) => writes.push(new TextDecoder().decode(bytes)),
    setInputNotice: (message) => notices.push(message),
    setStatus: noop, setStdin: noop, showTake: noop, showError: noop, clearError: noop, focus: noop, fit: noop,
  }, false);
  const lease = (state: WireLeaseState, other = false) =>
    control.control({ type: "lease", state, controlled: other || state === "controlled", controller: state === "controlled", viewers: 2 });
  control.setStream(true, false);
  control.control({ type: "ready" });
  lease(state);
  let data!: (value: string) => void, key!: (value: XtermKey) => void;
  const term = {
    onData: (receive: typeof data) => { data = receive; }, onKey: (receive: typeof key) => { key = receive; },
    onBinary: noop, paste: (text: string) => data(bracket(text)),
  };
  const input = new TerminalInputBinding(control);
  input.attach(term);
  const type = (value: string) => {
    key({ key: value, domEvent: { eventPhase: Event.AT_TARGET } as KeyboardEvent });
    data(value);
  };
  const paste = (source: PasteSource) => input.paste(term, source);
  return { control, lease, type, data, paste, writes, notices, takes: () => takes };
}

function transfer() {
  let signal: AbortSignal | undefined;
  const value = Promise.withResolvers<string[]>();
  return {
    load: (current: AbortSignal) => { signal = current; return value.promise; },
    resolve: value.resolve, reject: value.reject, signal: () => signal,
  };
}

test("file references, text, keyboard escape sequences and Enter retain gesture order", async () => {
  const v = view(), first = transfer(), second = transfer();
  v.paste(first.load);
  v.type("a");
  v.paste(second.load);
  v.paste("b");
  v.type("\x1b[A");
  v.type("\r");
  v.data("\x1b[0n");
  expect(v.writes).toEqual(["\x1b[0n"]);
  expect(second.signal()).toBeUndefined();
  first.resolve(["/first", " ", "/another"]);
  await Promise.resolve();
  expect(v.writes).toEqual(["\x1b[0n", bracket("/first"), bracket(" "), bracket("/another"), "a"]);
  second.resolve(["/second"]);
  await Promise.resolve();
  expect(v.writes).toEqual(["\x1b[0n", bracket("/first"), bracket(" "), bracket("/another"), "a", bracket("/second"), bracket("b"), "\x1b[A", "\r"]);
});

test("a staging failure discards every later gesture and allows a fresh paste", async () => {
  const v = view(), first = transfer(), second = transfer();
  v.paste(first.load);
  v.paste(second.load);
  v.type("\r");
  first.reject(new Error("transfer denied"));
  await Promise.resolve();
  expect(v.writes).toEqual([]);
  expect(second.signal()).toBeUndefined();
  expect(v.notices.at(-1)).toMatch(/discarded.*transfer denied.*again/i);
  v.paste("fresh");
  expect(v.writes).toEqual([bracket("fresh")]);
});

test("a large observing paste remains whole through this view's acquire and grant", () => {
  const v = view("observing");
  const text = "🙂".repeat(17_000);
  v.type("prefix");
  v.paste(text);
  v.type("\r");
  v.data("\x1b[0n");
  expect(v.takes()).toBe(1);
  expect(v.writes).toEqual([]);
  v.lease("acquiring");
  v.lease("controlled");
  expect(v.writes).toEqual(["prefix", bracket(text), "\r"]);
});

test("raw input has a bounded buffer including while an upload holds the queue", async () => {
  const v = view(), upload = transfer();
  v.paste(upload.load);
  v.type("x".repeat(64 * 1024));
  v.type("\r");
  expect(upload.signal()?.aborted).toBe(true);
  upload.resolve(["/late"]);
  await Promise.resolve();
  expect(v.writes).toEqual([]);
  expect(v.notices.at(-1)).toMatch(/64 KiB.*again/);
});

test("acquisition lost to another tab discards an observing paste before staging", () => {
  const v = view("observing"), upload = transfer();
  v.paste(upload.load);
  v.type("\r");
  v.lease("observing", true);
  v.lease("released");
  v.lease("controlled");
  expect(v.takes()).toBe(1);
  expect(upload.signal()).toBeUndefined();
  expect(v.writes).toEqual([]);
  expect(v.notices.at(-1)).toMatch(/control changed.*again/);
});

const interruptions = {
  handoff: (v: ReturnType<typeof view>) => { v.lease("observing", true); v.lease("released"); },
  release: (v: ReturnType<typeof view>) => v.control.release(),
  deny: (v: ReturnType<typeof view>) => v.control.control({ type: "error", message: "lease lost" }),
  disconnect: (v: ReturnType<typeof view>) => v.control.resetConnection(),
  reseed: (v: ReturnType<typeof view>) => v.control.setStream(false, true),
  dispose: (v: ReturnType<typeof view>) => v.control.dispose(),
};
for (const [event, interrupt] of Object.entries(interruptions)) {
  test(event + " cancels a staged reference and Enter even after a later grant", async () => {
    const v = view(), upload = transfer();
    v.paste(upload.load);
    v.type("\r");
    interrupt(v);
    expect(upload.signal()?.aborted).toBe(true);
    v.lease("controlled");
    v.control.setStream(true, false);
    upload.resolve(["/stale"]);
    await Promise.resolve();
    expect(v.writes).toEqual([]);
    if (event !== "dispose") expect(v.notices.at(-1)).toMatch(/discarded.*again/);
  });
}

test("protocol responses produced while seeding cannot become delayed input", () => {
  const v = view();
  v.control.setStream(false, true);
  v.data("\x1b[0n");
  v.type("\x1b[A");
  v.control.setStream(true, false);
  expect(v.writes).toEqual(["\x1b[A"]);
});
