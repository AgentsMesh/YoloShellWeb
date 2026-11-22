import type { Xterm } from "./terminalXterm.js";

/** The LAN client can run over HTTP, where the async Clipboard API is absent. */
function copyEvent(text: string): boolean {
  let written = false;
  const write = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    event.stopImmediatePropagation();
    written = true;
  };
  document.addEventListener("copy", write, true);
  try {
    return document.execCommand("copy") && written;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", write, true);
  }
}

export function copySelection(term: Xterm, unavailable: () => void): void {
  term.onSelectionChange(() => {
    const text = term.getSelection();
    if (!text) return;
    if (copyEvent(text)) return;
    const write = navigator.clipboard?.writeText(text);
    if (write) void write.catch(() => { if (term.getSelection() === text) unavailable(); });
    else unavailable();
  });
}
