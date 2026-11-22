import type { ChatContent, SessionUpdate } from "../../sdk/src/chatTypes.js";
import { el } from "./dom.js";
import { renderMarkdown } from "./markdownRender.js";

export function contentText(content: ChatContent): string {
  return content.type === "resource_link" ? content.name : content.text ?? "";
}

function details(kind: string, heading: string, value: string): HTMLElement {
  const node = el("details", `part ${kind}`);
  node.append(el("summary", "", heading), el("pre", "", value));
  return node;
}

export function updateView(update: SessionUpdate): HTMLElement {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "user_message_chunk": {
      if (update.content.type === "resource_link") return el("div", "part notice", update.content.name);
      const node = el("div", "part text markdown");
      node.append(renderMarkdown(contentText(update.content)));
      return node;
    }
    case "agent_thought_chunk":
      return details("thinking", "Thinking", contentText(update.content));
    case "tool_call":
      return details("tool", `Tool · ${update.title}`, typeof update.rawInput === "string"
        ? update.rawInput : JSON.stringify(update.rawInput ?? "", null, 2));
    case "tool_call_update":
      return details("tool", `Result${update.status === "failed" ? " · error" : ""} · ${update.toolCallId}`,
        (update.content ?? []).map((item) => contentText(item.content)).join("\n"));
    case "compaction_update":
      return el("div", "part notice", `Context compaction · ${(update.summary ?? []).map(contentText).join("\n")}`);
    case "notice":
      return el("div", "part notice", [update.title, update.description].filter(Boolean).join(" · "));
    default:
      return el("div", "part notice", "Unsupported session update");
  }
}
