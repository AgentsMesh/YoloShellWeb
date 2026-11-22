import { legacyUpdates } from "../../sdk/src/chatLegacy.js";
import type { Entry } from "./types.js";

export function entryKey(entry: Entry): string {
  return JSON.stringify(entry.id ?? [entry.role, entry.timestamp, entry.parts?.[0]?.text]);
}

export function entryLabel(entry: Entry): string {
  switch (entry.role) {
    case "user":
      return "You";
    case "assistant":
      return "Agent";
    case "tool":
      return "Tool";
    case "runtime":
      return "Runtime";
    default:
      return "Entry";
  }
}

export function entryUpdates(entry: Entry) {
  return entry.updates ?? legacyUpdates(entry);
}

export function promptText(entry: Entry): string {
  return entryUpdates(entry).flatMap((update) =>
    update.sessionUpdate === "user_message_chunk" && update.content.type === "text"
      ? [update.content.text] : [],
  ).join(" ");
}

export function timeLabel(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 24);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
