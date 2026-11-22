import type { TerminalControl } from "./terminalControl.js";
import type { PasteSource } from "./terminalInput.js";
import type { Xterm, XtermKey } from "./terminalXterm.js";

const ESCAPE = 0x1b;
const PASTE_START = [0x1b, 0x5b, 0x32, 0x30, 0x30, 0x7e];
const PASTE_END = [0x1b, 0x5b, 0x32, 0x30, 0x31, 0x7e];

/**
 * xterm answers terminal queries through onData as well. Query replies are
 * sent immediately on a live lease. onKey identifies keyboard escape
 * sequences. Explicit clipboard events retain their full paste until delivery.
 */
export class TerminalInputBinding {
  private pasteOpen = false;
  private inserting = false;
  private key: XtermKey | undefined;

  constructor(private readonly control: TerminalControl) {}

  attach(term: Pick<Xterm, "onKey" | "onData" | "onBinary">): void {
    // xterm fires onKey immediately before onData within the same DOM key event.
    term.onKey((key) => { this.key = key; });
    term.onData((data) => {
      const typedKey = this.key?.key === data && this.key.domEvent.eventPhase !== Event.NONE;
      this.key = undefined;
      this.send(new TextEncoder().encode(data), typedKey);
    });
    term.onBinary((data) =>
      this.control.writeNow(Uint8Array.from(data, (character) => character.charCodeAt(0))),
    );
  }

  paste(term: Pick<Xterm, "paste">, source: PasteSource): void {
    this.control.paste(source, (value) => {
      this.inserting = true;
      try { term.paste(value); }
      finally { this.inserting = false; }
    });
  }

  /** Forgets an unfinished observing paste across a reconnect. */
  reset(): void {
    this.pasteOpen = false;
    this.key = undefined;
  }

  private send(data: Uint8Array, typedKey: boolean): void {
    if (this.inserting) { this.control.writeNow(data); return; }
    if (this.control.controlled || typedKey) {
      this.pasteOpen = false;
      if (typedKey || data[0] !== ESCAPE) this.control.input(data);
      else this.control.writeNow(data);
      return;
    }
    if (this.pasteOpen) {
      if (indexOf(data, PASTE_END) >= 0) this.pasteOpen = false;
      return;
    }
    const start = indexOf(data, PASTE_START);
    if (start >= 0) {
      if (indexOf(data, PASTE_END, start + PASTE_START.length) < 0) this.pasteOpen = true;
      return;
    }
    if (data.length > 0 && data[0] !== ESCAPE) this.control.input(data);
  }
}

/** xterm emits a whole paste as one chunk containing both markers. */
function indexOf(data: Uint8Array, marker: number[], from = 0): number {
  for (let start = from; start + marker.length <= data.length; start += 1) {
    if (marker.every((byte, offset) => data[start + offset] === byte)) return start;
  }
  return -1;
}
