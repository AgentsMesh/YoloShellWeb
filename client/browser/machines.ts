import { byId, el } from "./dom.js";
import { inventory, scope } from "./appSelectors.js";
import { getState } from "./store.js";

export type MachineSummary = {
  machine?: string;
  label?: string;
  reachable?: boolean;
  freshness?: "live" | "stale" | "connecting" | "unreachable";
  entry?: boolean;
  capabilities?: { known?: boolean; create?: boolean; agent_start?: boolean };
};

export function machineLabel(hub: MachineSummary, entryMachine?: string): string {
  const label = hub.label?.trim();
  if (label) return label;
  if (hub.machine && hub.machine === entryMachine) return "This machine";
  return "Machine";
}

function accessLabel(hub: MachineSummary): string {
  if (hub.entry !== true && hub.capabilities?.known !== true) return "access pending";
  if (hub.entry === true) return "";
  if (hub.capabilities?.create === false) return "read-only";
  if (hub.capabilities?.agent_start === false) return "shells only";
  return "";
}

function machineRow(
  hub: MachineSummary,
  entryMachine: string | undefined,
  selected: boolean,
  context = "",
): HTMLLIElement {
  const item = el("li");
  const button = el("button", "row");
  button.type = "button";
  button.dataset.scope = hub.machine ?? "";
  if (selected) button.classList.add("is-selected");
  const copy = el("span", "row-copy");
  copy.append(
    el("span", "row-title", machineLabel(hub, entryMachine)),
    el("span", "row-context", context),
  );
  const freshness = hub.freshness ?? (hub.reachable ? "live" : "unreachable");
  const state = freshness === "live" ? "done" : freshness === "connecting" ? "unknown" : freshness === "stale" ? "idle" : "blocked";
  const label = freshness === "live" ? "Reachable" : freshness === "connecting" ? "Connecting" : freshness === "stale" ? "Stale" : "Unreachable";
  const status = el("span", `row-state state-${state}`);
  status.append(el("span", "", label));
  button.append(el("span", "row-mark", "M"), copy, status);
  item.append(button);
  return item;
}
export function renderMachines(): void {
  const snapshot = getState();
  const entry = inventory(snapshot)?.machine;
  const hubs = [...(inventory(snapshot)?.hubs?.hubs ?? [])].sort((left, right) => {
    if (left.machine === entry) return -1;
    if (right.machine === entry) return 1;
    return (left.label ?? "").localeCompare(right.label ?? "");
  });
  const rows =
    hubs.length > 1
      ? [
          machineRow(
            { label: "All machines", reachable: true },
            undefined,
            scope(snapshot) === null,
            `${hubs.length} machines`,
          ),
          ...hubs.map((hub) =>
            machineRow(
              hub,
              inventory(snapshot)?.machine,
              scope(snapshot) !== null && scope(snapshot) === hub.machine,
              accessLabel(hub),
            ),
          ),
        ]
      : [];
  byId("machines").hidden = rows.length === 0;
  byId("machine-list").replaceChildren(...rows);
  const newAgent = byId<HTMLButtonElement>("new-agent");
  const agentUnsupported =
    hubs.length > 0 && hubs.every((hub) =>
      hub.entry === true
        ? hub.capabilities?.agent_start === false
        : hub.capabilities?.agent_start !== true,
    );
  newAgent.disabled = agentUnsupported;
  newAgent.title = agentUnsupported
    ? "No machine in this Hub network supports starting agents yet"
    : "New agent";
}
