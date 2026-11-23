import type { Xterm } from "./terminalXterm.js";

/** The LAN client can run over HTTP, where the async Clipboard API is absent. */
function copyEvent(text: string, term: Xterm): boolean {
  let written = false;
  const write = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    event.stopImmediatePropagation();
    written = true;
  };
  document.addEventListener("copy", write, true);
  const textarea = term.element?.querySelector<HTMLTextAreaElement>(
    ".xterm-helper-textarea",
  );
  const previous = textarea?.value;
  const hadFocus = textarea === document.activeElement;
  try {
    if (textarea) {
      textarea.value = text;
      textarea.select();
    }
    return document.execCommand("copy") && written;
  } catch {
    return false;
  } finally {
    if (textarea && previous !== undefined) {
      textarea.value = previous;
      if (hadFocus) textarea.focus();
    }
    document.removeEventListener("copy", write, true);
  }
}

export function copySelection(term: Xterm, unavailable: () => void): void {
  term.onSelectionChange(() => {
    const text = term.getSelection();
    if (!text) return;
    // A synchronous copy keeps the clipboard current before a following paste
    // key can arrive. The async API is the fallback for browsers that reject
    // execCommand or expose no helper textarea.
    if (copyEvent(text, term)) return;
    const write = navigator.clipboard?.writeText(text);
    if (write) void write.catch(() => { if (term.getSelection() === text) unavailable(); });
    else unavailable();
  });
}
