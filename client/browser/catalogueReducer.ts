import { visibleAgent } from "./catalogue.js";
import { emptyConversation, type AppState } from "./appState.js";
import type { Intent } from "./appIntents.js";
import { buildIndex, terminalKey } from "./catalogueIndex.js";
import { identityKey, selectedForId, selectionOrigin } from "./appSelectors.js";
import type { SelectionId } from "./types.js";

type Replace = Extract<Intent, { type: "catalogue/replace" }>;
type Patch = Extract<Intent, { type: "catalogue/patch" }>;
type PendingAgents = Extract<Intent, { type: "catalogue/pendingAgents" }>;
type Scope = Extract<Intent, { type: "ui/scope" }>;
type Filter = Extract<Intent, { type: "ui/filter" }>;

/** Validate a selection identity and promote a shell claimed by an agent. */
function refreshed(state: AppState, id: SelectionId | null): SelectionId | null {
  if (!id) return null;
  const selected = selectedForId(state, id);
  if (!selected) return null;
  if (selected.kind === "agent") return id;
  const terminal = selected.terminal;
  const claimed = (
    state.catalogue.index.agentsByTerminal.get(terminalKey(terminal.address)) ?? []
  ).find((agent) => visibleAgent(agent, state.catalogue.index.terminals));
  if (!claimed?.cursor?.target?.address?.agent_id) return id;
  return {
    kind: "agent",
    id: claimed.cursor.target.address.agent_id,
    machine: claimed.cursor.target.address.machine,
  };
}

function apply(
  state: AppState,
  inventory: AppState["catalogue"]["inventory"],
  snapshot: AppState["catalogue"]["snapshot"],
  at: number,
): AppState {
  const previousKey = identityKey(state, state.selection.selected);
  const scope = state.ui.scope;
  const validScope =
    scope !== null &&
    (inventory?.hubs?.hubs ?? []).some((hub) => hub.machine === scope);
  const base: AppState = {
    ...state,
    catalogue: {
      inventory,
      index: buildIndex(inventory),
      snapshot,
      connected: true,
      updatedAt: at,
    },
    ui: { ...state.ui, scope: validScope ? scope : null },
  };
  const selected = refreshed(base, state.selection.selected);
  let next: AppState = {
    ...base,
    selection: { ...state.selection, selected },
  };
  if (previousKey !== identityKey(next, selected)) {
    next = {
      ...next,
      selection: { ...next.selection, epoch: next.selection.epoch + 1 },
      conversation: emptyConversation(),
    };
  }
  return next;
}

export function replace(state: AppState, intent: Replace): AppState {
  return apply(state, intent.inventory, intent.snapshot, intent.at);
}

export function patch(state: AppState, intent: Patch): AppState {
  return apply(
    state,
    intent.inventory,
    intent.inventory.snapshot,
    intent.at,
  );
}

export function connected(state: AppState): AppState {
  return state.catalogue.connected
    ? state
    : { ...state, catalogue: { ...state.catalogue, connected: true } };
}

export function disconnected(state: AppState): AppState {
  return state.catalogue.connected
    ? { ...state, catalogue: { ...state.catalogue, connected: false } }
    : state;
}

export function pendingAgents(state: AppState, intent: PendingAgents): AppState {
  return { ...state, creation: { pendingAgents: intent.pendingAgents } };
}

export function scope(state: AppState, intent: Scope): AppState {
  const id = state.selection.selected;
  const clear =
    intent.scope !== null && id !== null && selectionOrigin(state) !== intent.scope;
  return {
    ...state,
    ui: { ...state.ui, scope: intent.scope },
    selection: clear ? { ...state.selection, selected: null } : state.selection,
  };
}

export function filter(state: AppState, intent: Filter): AppState {
  return { ...state, ui: { ...state.ui, filter: intent.filter } };
}
