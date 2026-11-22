import type { WireTerminalTarget } from "../shared/protocol.js";
import type { PasteSource } from "./terminalInput.js";
import type { Xterm } from "./terminalXterm.js";
import { byId } from "./dom.js";
import { bindFilePaste, chooseFiles, terminalReference, uploadFile } from "./filePaste.js";

/** Let the browser produce a native paste event, including file and screenshot MIME data. */
export function browserPasteKey(event: KeyboardEvent, mac: boolean): boolean {
  if (event.altKey) return false;
  if (event.key === "Insert" && event.shiftKey && !event.ctrlKey && !event.metaKey) return true;
  return event.key.toLowerCase() === "v" && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

export function bindTerminalFiles(
  host: HTMLElement, term: Pick<Xterm, "attachCustomKeyEventHandler">, target: WireTerminalTarget,
  paste: (source: PasteSource) => void, signal: AbortSignal,
): void {
  const button = byId<HTMLButtonElement>("terminal-add-file");
  const receive = (files: File[]) => {
    if (signal.aborted || !files.length) return;
    paste(async (upload, progress) => {
      const references: string[] = [];
      for (const file of files) {
        upload.throwIfAborted();
        progress(`Transferring ${file.name}…`);
        const path = await uploadFile(file, target, upload);
        if (references.length) references.push(" ");
        references.push(terminalReference(path));
      }
      return references;
    });
  };
  button.disabled = false;
  button.addEventListener("click", () => chooseFiles(receive), { signal });
  signal.addEventListener("abort", () => { button.disabled = true; }, { once: true });
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  term.attachCustomKeyEventHandler((event) => !browserPasteKey(event, mac));
  bindFilePaste(host, receive, signal, paste);
}
