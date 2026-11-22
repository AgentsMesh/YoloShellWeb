import { api } from "./api.js";
import { inventory, selected } from "./appSelectors.js";
import { byId } from "./dom.js";
import { lifecycleActions } from "./lifecycleState.js";
import { terminalOfSelection, terminalTitle } from "./model.js";
import { getSession } from "./sessionLink.js";
import { getState } from "./store.js";

type Target = { machine: string; terminal_id: string; runtime_epoch: string };
let pending: Target | null = null;
let busy = false;

function selectedTerminal() {
  return terminalOfSelection(selected(getState()));
}

export function renderLifecycle(): void {
  const terminal = selectedTerminal();
  const actions = lifecycleActions(terminal ?? null, inventory(getState())?.hubs?.hubs);
  const menu = byId<HTMLDetailsElement>("session-options");
  const key = [terminal?.address?.machine, terminal?.address?.terminal_id,
    terminal?.runtime?.target?.runtime_epoch].join("/");
  if (menu.dataset.target !== key) menu.open = false;
  menu.dataset.target = key;
  menu.hidden = !terminal?.runtime?.target?.runtime_epoch ||
    byId("terminal-view").hidden;
  byId("terminal-end").hidden = !actions.terminate;
}

function open(): void {
  const terminal = selectedTerminal();
  if (!terminal || !lifecycleActions(terminal, inventory(getState())?.hubs?.hubs).terminate) return;
  const machine = terminal.address?.machine;
  const terminal_id = terminal.address?.terminal_id;
  const runtime_epoch = terminal.runtime?.target?.runtime_epoch;
  if (!machine || !terminal_id || !runtime_epoch || busy) return;
  pending = { machine, terminal_id, runtime_epoch };
  byId("lifecycle-copy").textContent = `${terminalTitle(terminal)} and every program running in it will end.`;
  byId("lifecycle-message").textContent = "";
  byId<HTMLDialogElement>("lifecycle").showModal();
  byId("lifecycle-cancel").focus();
}

export function bindLifecycle(): void {
  const menu = byId<HTMLDetailsElement>("session-options");
  const dialog = byId<HTMLDialogElement>("lifecycle");
  byId("terminal-end").addEventListener("click", open);
  document.addEventListener("click", (event) => {
    if (menu.open && !(event.target as Element).closest("#session-options summary")) menu.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }
  });
  byId("lifecycle-cancel").onclick = () => dialog.close();
  dialog.onclose = () => { pending = null; };
  byId<HTMLFormElement>("lifecycle-form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !pending) return;
    busy = true;
    const confirm = byId<HTMLButtonElement>("lifecycle-confirm");
    confirm.disabled = true;
    byId("lifecycle-message").textContent = "Ending…";
    try {
      await api.lifecycle({ ...pending, action: "terminate" });
      getSession()?.refresh();
      dialog.close();
    } catch (error) {
      byId("lifecycle-message").textContent = error instanceof Error ? error.message : "Could not end session";
    } finally {
      busy = false;
      confirm.disabled = false;
    }
  };
}
