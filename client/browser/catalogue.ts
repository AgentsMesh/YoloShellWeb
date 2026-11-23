import type { Agent, Inventory, Snapshot, Terminal } from "./types.js";

import { liveTerminal } from "../shared/terminalLifecycle.js";

export { liveTerminal } from "../shared/terminalLifecycle.js";

export function liveAgent(agent: Agent): boolean {
  const state = agent.lifecycle?.state;
  return state === "starting" || state === "running";
}

/**
 * A running agent stays visible while its terminal is live, even when one
 * observation says it is unreachable. A transient "unknown" lifecycle is the
 * same kind of observation gap, but it may only keep a row alive while the
 * terminal is live and the agent is still reachable; otherwise retired
 * entries with no terminal would become permanent ghosts.
 */
export function visibleAgent(agent: Agent, terminals: Terminal[]): boolean {
  const state = agent.lifecycle?.state;
  const id = agent.terminal?.address?.terminal_id;
  const terminal = id
    ? terminals.find((candidate) => candidate.address?.terminal_id === id &&
        candidate.address?.machine === agent.terminal?.address?.machine)
    : undefined;
  if (state === "starting" || state === "running") {
    if (!terminal) {
      return agent.reachability === "reachable" && agent.freshness === "current";
    }
    return liveTerminal(terminal);
  }
  return (
    state === "unknown" &&
    agent.freshness === "current" &&
    terminal !== undefined &&
    liveTerminal(terminal) &&
    agent.reachability === "reachable"
  );
}

/** A reply is usable only when every catalogue section is present. */
export function coherent(value: unknown): value is Inventory {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Inventory;
  return (
    Array.isArray(item.terminals?.terminals) &&
    Array.isArray(item.agents?.agents) &&
    Array.isArray(item.hubs?.hubs)
  );
}

export function newer(previous: Snapshot | undefined, next: Snapshot | undefined): boolean {
  if (!next || typeof next.sequence !== "number") return true;
  if (!previous || previous.server !== next.server) return true;
  return next.sequence > (previous.sequence ?? -1);
}
