import { byId } from "./dom.js";
import { terminalOfSelection } from "./model.js";
import { terminalPayload } from "./payload.js";
import { inventory, selected as selection } from "./appSelectors.js";
import { getSession } from "./sessionLink.js";
import { getState } from "./store.js";
import { TerminalView } from "./terminalView.js";
import type { Selected } from "./types.js";

type Mount = { key: string; status?: string; view: TerminalView | null; retry: boolean };
let current: Mount | null = null;

function unmount(): void {
  current?.view?.dispose();
  current = null;
  byId<HTMLButtonElement>("terminal-retry").onclick = null;
  byId("terminal-retry").hidden = true;
  byId("terminal-error").hidden = true;
  byId("terminal-take").hidden = true;
  byId("terminal-size").textContent = "";
  byId("terminal-host").hidden = true;
}

function stopped(mount: Mount, exited: boolean, message: string): void {
  if (current !== mount) return;
  mount.view?.dispose();
  mount.view = null;
  mount.retry = !exited;
  byId("terminal-host").hidden = true;
  byId("terminal-size").textContent = "";
  byId("terminal-take").hidden = true;
  const status = byId("terminal-input-state");
  status.classList.remove("is-active");
  status.textContent = exited ? "Session exited" : "Terminal unavailable";
  const error = byId("terminal-error");
  error.textContent = message;
  error.hidden = !message;
  const retry = byId<HTMLButtonElement>("terminal-retry");
  retry.hidden = exited;
  retry.onclick = exited ? null : () => {
    unmount();
    syncTerminalView(selection(getState()));
  };
  getSession()?.refresh();
}

export function syncTerminalView(selected: Selected | null, takeControl = false): void {
  const terminal = terminalOfSelection(selected);
  if (!terminal || byId("terminal-view").hidden) {
    unmount();
    return;
  }
  const payload = terminalPayload(terminal);
  const machine = payload.machine ?? inventory(getState())?.machine;
  const { terminal_id, runtime_epoch } = payload;
  if (typeof machine !== "string" || typeof terminal_id !== "string" || typeof runtime_epoch !== "string") {
    unmount();
    byId("terminal-input-state").textContent = "Terminal unavailable";
    return;
  }
  const key = `${machine}:${terminal_id}:${runtime_epoch}`;
  const status = terminal.runtime?.status;
  if (current?.key === key && !(current.retry && current.status !== status)) {
    if (takeControl) current.view?.takeControl();
    current.view?.reconcileSize(terminal.runtime?.size?.cols, terminal.runtime?.size?.rows);
    return;
  }
  unmount();
  const mount: Mount = { key, status, view: null, retry: false };
  current = mount;
  byId("terminal-host").hidden = false;
  mount.view = new TerminalView(
    { machine, terminal_id, runtime_epoch }, takeControl,
    (exited, message) => stopped(mount, exited, message),
    selected?.kind === "agent" ? "agent" : "modifier",
  );
  mount.view.open();
}
