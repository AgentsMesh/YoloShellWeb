import { stageChunk } from "../../sdk/src/attachments";
import { HubError } from "../../sdk/src/hub";
import { ApiError } from "./errors";
import { transfer } from "./hub";
import { terminalTarget } from "./target";
import { uuid } from "./validate";

export async function stageAttachment(body: Record<string, unknown>) {
  const target = terminalTarget(body);
  const { name, offset, data, eof } = body;
  if (typeof name !== "string" || typeof offset !== "number" || !Number.isSafeInteger(offset) ||
      offset < 0 || typeof data !== "string" || typeof eof !== "boolean") {
    throw new ApiError(400, "Invalid attachment chunk");
  }
  const chunk = { name, offset, data, eof, upload_id: uuid(body.upload_id) };
  try {
    const receipt = await transfer(target.address.hub_id, (hub) => stageChunk(hub, target, chunk));
    return { upload_id: receipt.upload_id, next_offset: receipt.next_offset, path: receipt.path };
  } catch (error) {
    if (error instanceof HubError) {
      const code = (error.data as { code?: string } | null)?.code;
      if (error.code === -32601 || code === "unsupported") {
        throw new ApiError(409, "File transfer is unavailable on this machine. Update its Hub to paste files.");
      }
      if (code === "unauthorized" || code === "permission_denied") {
        throw new ApiError(403, "The connection to this machine does not grant terminal write access.");
      }
      if (code === "conflict" || code === "not_found" || code === "target_mismatch") {
        throw new ApiError(409, "The terminal or attachment changed during the transfer.");
      }
    }
    throw error;
  }
}
