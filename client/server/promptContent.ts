import type { ChatContent } from "../../sdk/src/chatTypes";
import { ApiError } from "./errors";
import { message, record } from "./validate";

export function promptContent(value: unknown): ChatContent[] {
  if (!Array.isArray(value) || !value.length) throw new ApiError(400, "Prompt content is empty");
  return value.map((raw) => {
    const block = record(raw);
    if (block.type === "text") return { type: "text" as const, text: message(block.text) };
    if (block.type !== "resource_link" || typeof block.name !== "string" ||
        typeof block.uri !== "string" || !block.uri.startsWith("file:///")) {
      throw new ApiError(400, "Invalid prompt attachment");
    }
    return {
      type: "resource_link" as const, name: block.name, uri: block.uri,
      ...(typeof block.mimeType === "string" ? { mimeType: block.mimeType } : {}),
    };
  });
}
