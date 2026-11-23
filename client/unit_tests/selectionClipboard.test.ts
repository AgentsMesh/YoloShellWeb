import { expect, test } from "bun:test";
import { copySelection } from "../browser/selectionClipboard";

test("fallback copy selects xterm's helper textarea when Clipboard API is unavailable", () => {
  let copied = "";
  const textarea = {
    value: "",
    select() { (globalThis as any).document.execCommand("copy"); },
    focus() {},
  } as HTMLTextAreaElement;
  const element = { querySelector: () => textarea } as unknown as HTMLElement;
  const listeners = new Map<string, EventListener>();
  (globalThis as any).document = {
    activeElement: null,
    addEventListener(type: string, listener: EventListener) { listeners.set(type, listener); },
    removeEventListener(type: string) { listeners.delete(type); },
    execCommand(command: string) {
      if (command !== "copy") return false;
      const event = { clipboardData: { setData(_kind: string, value: string) { copied = value; } }, preventDefault() {}, stopImmediatePropagation() {} } as unknown as ClipboardEvent;
      listeners.get("copy")?.(event);
      return true;
    },
  };
  const callbacks: (() => void)[] = [];
  const term = { element, getSelection: () => "agent selection", onSelectionChange(callback: () => void) { callbacks.push(callback); return { dispose() {} }; } } as any;
  copySelection(term, () => { throw new Error("copy failed"); });
  callbacks[0]();
  expect(copied).toBe("agent selection");
  expect(textarea.value).toBe("");
});
