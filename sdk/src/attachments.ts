import type { AttachmentTarget } from "./terminalAttachment.ts";
import { uploadAttachment, type AttachmentChunk, type AttachmentProgress } from "./attachmentUpload.ts";
import type { HubClient } from "./hub.ts";

export async function stageChunk(hub: HubClient, target: AttachmentTarget, chunk: AttachmentChunk) {
  const result = await hub.request("stage_attachment", {
    request: { ...chunk, target },
  }, target.address.hub_id) as { attachment: AttachmentProgress & { target: AttachmentTarget } };
  const receipt = result.attachment;
  if (receipt?.target?.runtime_epoch !== target.runtime_epoch ||
      receipt.target.address?.terminal_id !== target.address.terminal_id ||
      receipt.target.address.hub_id !== target.address.hub_id) {
    throw new Error("Attachment receipt belongs to a different runtime");
  }
  return receipt;
}

export function stageFile(
  hub: HubClient, target: AttachmentTarget, file: Blob, name: string,
  options?: { uploadId?: string; signal?: AbortSignal },
): Promise<string> {
  return uploadAttachment(file, name, (chunk) => stageChunk(hub, target, chunk), options);
}
