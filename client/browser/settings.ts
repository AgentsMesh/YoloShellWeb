import { forgetToken, loadToken } from "./api.js";
import { coherent } from "./catalogue.js";
import { applyCataloguePatch, type CataloguePatch } from "./cataloguePatch.js";
import { byId, el } from "./dom.js";
import { bindGate, showApp, showGate } from "./gate.js";
import {
  defaultMachine, enableNotify, loadNotify, loadQuiet, saveDefaultMachine, saveNotify, saveQuiet,
} from "./preferences.js";
import { SessionClient } from "./session.js";
import type { Inventory } from "./types.js";

const machineSelect = byId<HTMLSelectElement>("default-machine");
const notify = byId<HTMLInputElement>("notify");
const quiet = byId<HTMLInputElement>("quiet");
let inventory: Inventory | null = null;

function machines(next: Inventory): void {
  inventory = next;
  const options = [new Option("Entry machine", "")];
  const rows: HTMLElement[] = [];
  for (const hub of next.hubs?.hubs ?? []) {
    if (!hub.machine) continue;
    const name = hub.label || "Machine";
    if (!hub.entry) options.push(new Option(name, hub.machine));
    const row = el("li", "setting-row");
    const providers = (hub.providers ?? []).filter((p) => p.available).map((p) => p.display_name);
    const copy = el("span");
    copy.append(el("strong", "", name), el("small", "", [
      hub.entry ? "Entry machine" : "Peer", ...providers,
    ].filter(Boolean).join(" · ")));
    row.append(copy, el("span", "machine-status", hub.reachable ? "Reachable" : "Unreachable"));
    rows.push(row);
  }
  machineSelect.replaceChildren(...options);
  const preferred = defaultMachine();
  machineSelect.value = options.find((o) => o.value === preferred)?.value ?? "";
  machineSelect.disabled = options.length === 1;
  byId("settings-machines").replaceChildren(...rows);
  byId("machines-status").textContent = rows.length ? "" : "No machines available";
}

const session = new SessionClient({
  catalogue(value) {
    if (coherent(value)) machines(value);
  },
  cataloguePatch(raw) {
    const patch = raw as CataloguePatch;
    const next = applyCataloguePatch(inventory, patch);
    if (next.applied) machines(next.inventory);
    else session.snapshot();
  },
  connected: showApp,
  disconnected() { byId("machines-status").textContent = "Disconnected. Reconnecting…"; },
  unauthorized() { forgetToken(); showGate("Token rejected.", "bad"); },
  conversation() {},
});

function start(): void {
  session.close();
  session.start();
}

notify.checked = loadNotify();
quiet.checked = loadQuiet();
quiet.onchange = () => saveQuiet(quiet.checked);
notify.onchange = async () => {
  const enabled = notify.checked;
  saveNotify(enabled);
  const note = byId("notify-status");
  note.textContent = "";
  if (enabled && !(await enableNotify()) && notify.checked) {
    note.textContent = "In-page alerts are enabled. Desktop notifications need browser permission and HTTPS or localhost.";
  }
};
machineSelect.onchange = () => saveDefaultMachine(machineSelect.value);
byId("lock").onclick = () => { session.close(); forgetToken(); location.reload(); };
bindGate(start);
if (loadToken()) start();
else showGate();
