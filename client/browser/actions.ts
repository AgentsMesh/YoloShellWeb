import { api } from "./api.js";
import { answerResult } from "./answer.js";
import { clientId } from "./clientIdentity.js";
import { loadOlder } from "./conversationController.js";
import { byId } from "./dom.js";
import { interruptPayload, selectionPayload } from "./payload.js";
import { submitPrompt } from "./promptSend.js";
import { renderPane, renderStatus } from "./render.js";
import { fail, setBusy, setStatus } from "./requestController.js";
import { selected } from "./appSelectors.js";
import { dispatch, getState } from "./store.js";

export { closeDrawer } from "./drawer.js";

async function act(action: { cancel: true } | { interaction_id: string; choice?: string; answer?: string }): Promise<void> {
  const state = getState();
  const target = selected(state);
  if (!target || target.kind !== "agent" || state.request.busy) return;
  setBusy(true);
  const cancel = "cancel" in action;
  setStatus(cancel ? "Interrupting…" : "Answering…");
  renderPane();
  try {
    const result = cancel
      ? await api.cancel({ ...interruptPayload(target.agent), client_id: clientId() })
      : await api.respond({ ...selectionPayload(target), ...action, client_id: clientId() });
    if (getState().selection.epoch !== state.selection.epoch) return;
    const answer = answerResult(result.receipt?.outcome);
    if (!cancel && answer.clear) dispatch({ type: "selection/interactionCleared" });
    setStatus(cancel ? (answer.ok ? "Interrupt sent" : "Interrupt unconfirmed") : answer.text, answer.ok ? "ok" : "bad");
  } catch (error) {
    if (getState().selection.epoch === state.selection.epoch) fail(error);
  } finally {
    setBusy(false);
    renderPane();
    renderStatus();
  }
}

export function bindActions(): void {
  byId<HTMLFormElement>("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPrompt();
  });
  byId("chat-cancel").onclick = () => void act({ cancel: true });
  const form = byId<HTMLFormElement>("interaction-answer");
  form.onsubmit = (event) => {
    event.preventDefault();
    if (form.dataset.id) void act({ interaction_id: form.dataset.id, answer: byId<HTMLInputElement>("interaction-text").value });
  };
  const field = byId<HTMLTextAreaElement>("prompt");
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submitPrompt();
    }
  });
  byId<HTMLButtonElement>("older").addEventListener("click", () => void loadOlder());
  byId("interaction-choices").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-choice]",
    );
    if (!button) return;
    void act({ interaction_id: button.dataset.interaction ?? "", choice: button.dataset.choice ?? "" });
  });
}
