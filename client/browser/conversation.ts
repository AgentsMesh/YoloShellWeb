import { getState } from "./store.js";
import { updateView } from "./chatUpdateView.js";
import { byId, el } from "./dom.js";
import { entryLabel, entryUpdates, timeLabel } from "./conversationModel.js";
import type { Entry } from "./types.js";

function reasonLabel(reason: string): string {
  switch (reason) {
    case "evidence_unavailable":
      return "no readable transcript for this agent";
    case "reader_busy":
      return "the conversation reader is busy";
    case "history_limit_exceeded":
      return "the transcript exceeds the reader limit";
    case "unsupported_provider":
      return "this provider has no conversation reader";
    default:
      return reason.replaceAll("_", " ");
  }
}

function turnView(entry: Entry): HTMLElement {
  const article = el("article", `turn turn-role-${entry.role ?? "runtime"}`);
  const head = el("div", "turn-head");
  head.append(el("span", "", entryLabel(entry)));
  const time = timeLabel(entry.timestamp);
  if (time) head.append(el("span", "", time));
  article.append(head);
  for (const update of entryUpdates(entry)) article.append(updateView(update));
  return article;
}

export function renderConversation(stick = true): void {
  const view = byId("conversation");
  const nearBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 48;
  const turns = byId("turns");
  const snapshot = getState();
  const conversation = snapshot.conversation;
  const entries = conversation.entries;
  const hadTurns = turns.childElementCount > 0;
  turns.replaceChildren(...entries.map(turnView));
  const note = byId("conversation-note");
  note.className = "note";
  if (!conversation.available) {
    const reason = conversation.reason
      ? `: ${reasonLabel(conversation.reason)}`
      : "";
    const restart =
      conversation.reason === "evidence_unavailable"
        ? " If this agent started before the current runtime, restart it to enable Chat."
        : "";
    note.textContent = `Conversation unavailable${reason}. Use Terminal to interact with this agent.${restart}`;
    note.classList.add("bad");
  } else if (conversation.note) {
    note.textContent = conversation.note;
  } else if (!conversation.loaded) {
    note.textContent = "Loading conversation…";
  } else if (entries.length === 0) {
    note.textContent = "No recorded messages yet.";
  } else {
    note.textContent = "";
  }
  note.hidden = note.textContent === "";
  const older = byId<HTMLButtonElement>("older");
  older.hidden = !snapshot.conversation.nextCursor || snapshot.conversation.older;
  older.disabled = snapshot.conversation.older;
  older.textContent = snapshot.conversation.older ? "Loading…" : "Load older messages";
  if (stick && (nearBottom || !hadTurns)) view.scrollTop = view.scrollHeight;
}
