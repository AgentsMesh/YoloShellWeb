import { uploadAttachment } from "../../sdk/src/attachmentUpload.js";
import type { WireTerminalTarget } from "../shared/protocol.js";
import { api, ApiError } from "./api.js";

export function bindFilePaste(
  element: HTMLElement, receive: (files: File[]) => void, signal?: AbortSignal, text?: (value: string) => void,
): void {
  element.addEventListener("paste", (event) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files = Array.from(clipboard.files);
    if (!files.length) {
      for (const item of Array.from(clipboard.items)) {
        const file = item.kind === "file" ? item.getAsFile() : null;
        if (file) files.push(file);
      }
    }
    const plain = !files.length && text ? clipboard.getData("text/plain") : "";
    if (!files.length && !plain) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (files.length) receive(files);
    else text?.(plain);
  }, { capture: true, signal });
}

export function uploadFile(file: File, target: WireTerminalTarget, signal?: AbortSignal): Promise<string> {
  return uploadAttachment(file, file.name, async (chunk) => {
    const body = { ...chunk, ...target };
    try {
      return await api.stageAttachment(body, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ApiError ? error.status < 500 : !(error instanceof TypeError || error instanceof DOMException)) throw error;
      return api.stageAttachment(body, signal);
    }
  }, { signal });
}

export function terminalReference(path: string): string {
  if (/^\/[a-zA-Z0-9_./-]+$/.test(path)) return path;
  return "'" + path.replaceAll("'", "'\\''") + "'";
}

export function fileUri(path: string): string {
  return "file://" + path.split("/").map(encodeURIComponent).join("/");
}

export function chooseFiles(receive: (files: File[]) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.onchange = () => receive(Array.from(input.files ?? []));
  input.click();
}
