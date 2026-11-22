import { api } from "./api.js";
import { outcomeLabel } from "./answer.js";
import { clientId } from "./clientIdentity.js";
import { entryKey } from "./conversationModel.js";
import { clearSent, hasFiles, preparePrompt } from "./composerDraft.js";
import { byId } from "./dom.js";
import { selectionPayload } from "./payload.js";
import { promptVisible } from "./promptReceipt.js";
import { renderPane, renderStatus } from "./render.js";
import { fail, setBusy, setStatus } from "./requestController.js";
import { selected } from "./appSelectors.js";
import { getState, subscribe } from "./store.js";
import type { Entry } from "./types.js";

const CONFIRM_WAIT_MS = 6000;

/** Wait for the pushed conversation page, never re-send an uncertain prompt. */
function confirmed(
  text: string,
  baseline: ReadonlySet<string>,
  generation: number,
): Promise<boolean> {
  const state = getState();
  if (
    state.selection.epoch === generation &&
    promptVisible(state.conversation.entries, baseline, text)
  ) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    let off: () => void = () => {};
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(value);
    };
    off = subscribe((next) => {
      if (next.selection.epoch !== generation) {
        finish(false);
        return;
      }
      if (promptVisible(next.conversation.entries, baseline, text)) finish(true);
    });
    timer = setTimeout(() => finish(false), CONFIRM_WAIT_MS);
  });
}

export async function submitPrompt(): Promise<void> {
  const state = getState();
  const target = selected(state);
  const field = byId<HTMLTextAreaElement>("prompt");
  const text = field.value;
  if (
    !target ||
    target.kind !== "agent" ||
    state.selection.lens !== "chat" ||
    state.request.busy
  ) {
    return;
  }
  const attachments = hasFiles();
  if (!text.trim() && !attachments) return;
  const baseline = new Set<string>(
    state.conversation.entries.map((entry: Entry) => entryKey(entry)),
  );
  const generation = state.selection.epoch;
  setBusy(true);
  setStatus("Sending…");
  renderPane();
  try {
    const body = await preparePrompt(text, (name) => { setStatus(`Transferring ${name}…`); renderStatus(); });
    if (getState().selection.epoch !== generation) return;
    const result = (await api.prompt({ ...selectionPayload(target), ...body, client_id: clientId() })) as {
      prompt?: { outcome?: unknown };
    };
    const outcome = result.prompt?.outcome;
    if (getState().selection.epoch !== generation) {
      if (["delivered", "turn_ended"].includes(String(outcome))) clearSent(target);
      return;
    }
    if (outcome === "unknown") {
      setStatus("Prompt outcome unconfirmed; checking the conversation…");
      renderStatus();
      if (!attachments && await confirmed(text, baseline, generation)) {
        setStatus("Prompt delivered", "ok");
        clearSent(target);
      } else {
        setStatus(
          "Delivery unconfirmed; check the conversation before resending",
          "bad",
        );
      }
    } else if (outcome === "rejected" || outcome === "exited") {
      setStatus(outcomeLabel(outcome), "bad");
    } else {
      setStatus(outcomeLabel(outcome), "ok");
      clearSent(target);
    }
  } catch (error) {
    if (getState().selection.epoch === generation) fail(error);
  } finally {
    setBusy(false);
    renderPane();
    renderStatus();
  }
}
