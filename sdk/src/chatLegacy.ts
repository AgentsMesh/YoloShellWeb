import type { ChatContent, SessionUpdate } from "./chatTypes";

type LegacyPart = {
  kind?: string; text?: string; summary?: string; name?: string; call_id?: string;
  arguments?: string; output?: string; is_error?: boolean; media_type?: string | null; native_kind?: string;
};
type LegacyEntry = { id?: number[]; role?: string; parts?: LegacyPart[] };

function hexId(bytes: number[]): string {
  return bytes.map((n) => n.toString(16).padStart(2, "0")).join("");
}

const text = (value = ""): ChatContent => ({ type: "text", text: value });
export function legacyUpdates(entry: LegacyEntry): SessionUpdate[] {
  return (entry.parts ?? []).map((part, index) => {
    switch (part.kind ?? (typeof part.text === "string" ? "text" : "notice")) {
      case "text":
        if (entry.role === "runtime" || entry.role === "tool") {
          return { sessionUpdate: "notice", severity: "info", title: part.text ?? "" };
        }
        return { sessionUpdate: entry.role === "user" ? "user_message_chunk" : "agent_message_chunk", content: text(part.text) };
      case "thinking":
        return { sessionUpdate: "agent_thought_chunk", content: text(part.text) };
      case "tool_call":
        return { sessionUpdate: "tool_call", toolCallId: part.call_id ?? "", title: part.name ?? "Tool", rawInput: part.arguments };
      case "tool_result":
        return { sessionUpdate: "tool_call_update", toolCallId: part.call_id ?? "",
          status: part.is_error ? "failed" : "completed", content: [{ type: "content", content: text(part.output) }] };
      case "compaction":
        return { sessionUpdate: "compaction_update", compactionId: `${hexId(entry.id ?? [])}-${index}`,
          status: "completed", summary: [text(part.summary)] };
      case "image_unavailable":
        return { sessionUpdate: "notice", severity: "info", title: "Image unavailable", description: part.media_type ?? undefined };
      case "unsupported":
        return { sessionUpdate: "notice", severity: "warning", title: "Unsupported content", description: part.native_kind };
      default:
        return { sessionUpdate: "notice", severity: "info", title: part.text ?? "Notice" };
    }
  });
}
