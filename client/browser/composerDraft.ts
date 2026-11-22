import type { ChatContent } from "../../sdk/src/chatTypes.js";
import { selected } from "./appSelectors.js";
import type { CatalogueIndex } from "./catalogueIndex.js";
import { byId, el } from "./dom.js";
import { bindFilePaste, chooseFiles, fileUri, uploadFile } from "./filePaste.js";
import { agentPayload } from "./payload.js";
import { getState } from "./store.js";
import type { Selected } from "./types.js";
import type { WireTerminalTarget } from "../shared/protocol.js";

type Attachment = { file: File; path?: string };
type Draft = { machine?: string; text: string; files: Attachment[] };
const drafts = new Map<string, Draft>();
let visible: { key: string; machine?: string } = { key: "" };
let lastIndex: CatalogueIndex | undefined;
let sending: AbortController | null = null;

function keyOf(target: Selected | null): string {
  return target?.kind === "agent" ? JSON.stringify(agentPayload(target.agent)) : "";
}

function currentDraft(): Draft {
  let draft = drafts.get(visible.key);
  if (!draft) {
    draft = { machine: visible.machine, text: "", files: [] };
    drafts.set(visible.key, draft);
  }
  return draft;
}

function retireDrafts(index: CatalogueIndex): void {
  if (index === lastIndex) return;
  lastIndex = index;
  if (!drafts.size) return;
  const active = new Set(index.agents.map((agent) => keyOf({ kind: "agent", agent })));
  for (const [key, draft] of drafts) {
    const machine = index.machinesByHandle.get(draft.machine ?? "");
    if (machine?.reachable && machine.freshness === "live" && (machine.revision ?? 0) > 0 && !active.has(key)) {
      drafts.delete(key);
    }
  }
}

function showFiles(): void {
  const list = byId("chat-files");
  const draft = drafts.get(visible.key);
  list.replaceChildren(...(draft?.files ?? []).map((item) => {
    const button = el("button", "draft-file", item.file.name + " ×");
    button.type = "button";
    button.setAttribute("aria-label", `Remove ${item.file.name}`);
    button.disabled = getState().request.busy;
    button.onclick = () => {
      if (!draft) return;
      draft.files = draft.files.filter((value) => value !== item);
      showFiles();
    };
    return button;
  }));
  list.hidden = list.childElementCount === 0;
}

export function syncComposer(target: Selected | null, chat: boolean): void {
  const key = chat ? keyOf(target) : "";
  if (visible.key !== key) {
    sending?.abort();
    const field = byId<HTMLTextAreaElement>("prompt");
    const previous = drafts.get(visible.key);
    if (previous) previous.text = field.value;
    visible = { key, machine: target?.kind === "agent" ? target.agent.cursor?.target?.address?.machine : undefined };
    field.value = drafts.get(key)?.text ?? "";
    field.style.height = "";
  }
  retireDrafts(getState().catalogue.index);
  byId<HTMLButtonElement>("chat-add-file").disabled = getState().request.busy;
  showFiles();
}

export function bindComposerFiles(): void {
  const field = byId<HTMLTextAreaElement>("prompt");
  const add = (files: File[]) => {
    if (!visible.key || !files.length || getState().request.busy) return;
    currentDraft().files.push(...files.map((file) => ({ file })));
    showFiles();
    field.focus();
  };
  bindFilePaste(field, add);
  byId("chat-add-file").onclick = () => {
    const key = visible.key;
    chooseFiles((files) => { if (key === visible.key) add(files); });
  };
  field.addEventListener("input", () => { if (visible.key) currentDraft().text = field.value; });
}

export function hasFiles(): boolean { return Boolean(drafts.get(visible.key)?.files.length); }

export async function preparePrompt(text: string, progress: (name: string) => void) {
  const target = selected(getState());
  const key = keyOf(target);
  const files = drafts.get(key)?.files ?? [];
  if (!files.length) return { text };
  const { machine, terminal_id } = target?.kind === "agent" ? target.agent.terminal?.address ?? {} : {};
  const runtime_epoch = target?.kind === "agent" ? target.agent.terminal?.runtime_epoch : undefined;
  if (!machine || !terminal_id || !runtime_epoch || key !== visible.key) throw new Error("The selected agent changed.");
  const runtime: WireTerminalTarget = { machine, terminal_id, runtime_epoch };
  const controller = new AbortController();
  sending = controller;
  try {
    const content: ChatContent[] = text.trim() ? [{ type: "text", text }] : [];
    for (const item of files) {
      progress(item.file.name);
      item.path ??= await uploadFile(item.file, runtime, controller.signal);
      controller.signal.throwIfAborted();
      content.push({ type: "resource_link", name: item.file.name, uri: fileUri(item.path),
        ...(item.file.type ? { mimeType: item.file.type } : {}) });
    }
    return { content };
  } finally {
    if (sending === controller) sending = null;
  }
}

export function clearSent(target: Selected): void {
  const key = keyOf(target);
  drafts.delete(key);
  if (visible.key !== key) return;
  const field = byId<HTMLTextAreaElement>("prompt");
  field.value = "";
  field.style.height = "";
  showFiles();
}
