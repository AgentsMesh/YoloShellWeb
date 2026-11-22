import type { AttachmentTarget } from "./terminalAttachment";

export type ChatAgent = { address: { hub_id: string; agent_id: string }; execution_id: string };
export type ChatBinding = { agent: ChatAgent; runtime: AttachmentTarget };
export type ChatAddress = { hub_id: string; conversation_id: number[] };
export type ChatSession = { version: 1; sessionId: string; address: ChatAddress; binding: ChatBinding };
export type ChatCursor = { address: ChatAddress; history_generation: number[]; before_offset: number };
export type ChatReadRequest = {
  address: ChatAddress;
  binding: ChatBinding;
  cursor: ChatCursor | null;
  limits: { entries: number; bytes: number };
  since_revision: number[] | null;
  since_generation: number[] | null;
};

export type ChatContent =
  | { type: "text"; text: string }
  | { type: "resource_link"; name: string; uri: string; mimeType?: string };

export type SessionUpdate =
  | { sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk"; content: ChatContent }
  | { sessionUpdate: "tool_call"; toolCallId: string; title: string; rawInput?: unknown }
  | { sessionUpdate: "tool_call_update"; toolCallId: string; status?: string; content?: { type: "content"; content: ChatContent }[] }
  | { sessionUpdate: "notice"; severity?: string; title: string; description?: string }
  | { sessionUpdate: "compaction_update"; compactionId: string; status: string; summary?: ChatContent[] };

export type ChatEntry = { id: number[]; role: string; timestamp?: string | null; updates: SessionUpdate[] };
export type ChatPage = {
  sessionId: string;
  entries: ChatEntry[];
  next_cursor: ChatCursor | null;
  history_generation: number[];
  revision: number[];
  availability: string;
  partial: string[];
};
export type ChatReading =
  | { status: "page"; page: ChatPage }
  | { status: "unchanged"; history_generation: number[]; revision: number[] };
