import type { Agent, Terminal } from "./types.js";

export type PendingAgent = {
  machine: string;
  terminalId: string;
  provider: string;
  name?: string;
  cwd?: string;
  /** Local creation time; the grace window survives snapshots that omit the row. */
  at?: number;
};

const PENDING_GRACE_MS = 90_000;
const STARTING_GRACE_MS = 5_000;

const KEY = "yolo-pending-agents";
const starting = new Map<string, number>();

function key(machine: string, terminalId: string): string {
  return `${machine}:${terminalId}`;
}

/** A just-claimed creation may still be delivering its first prompt. */
export function agentStarting(machine: string, terminalId: string, now = Date.now()): boolean {
  const value = key(machine, terminalId);
  const at = starting.get(value);
  if (at === undefined) return false;
  if (now - at >= STARTING_GRACE_MS) {
    starting.delete(value);
    return false;
  }
  return true;
}

export function loadPendingAgents(): PendingAgent[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item) =>
          typeof item?.machine === "string" &&
          typeof item?.terminalId === "string" &&
          typeof item?.provider === "string",
      )
      .map((item) => ({
        ...item,
        at: typeof item.at === "number" ? item.at : Date.now(),
      }));
  } catch {
    return [];
  }
}

export function savePendingAgents(agents: PendingAgent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(agents));
  } catch {
    // private mode keeps the list in memory for this tab only
  }
}

export function addPendingAgent(
  agents: PendingAgent[],
  next: PendingAgent,
): PendingAgent[] {
  const value = agents.filter(
    (agent) =>
      agent.machine !== next.machine || agent.terminalId !== next.terminalId,
  );
  value.push({ ...next, at: Date.now() });
  return value;
}

/** Drop a pending row once its terminal ended or a real agent claimed it. */
export function prunePendingAgents(
  pending: PendingAgent[],
  terminals: Terminal[],
  agents: Agent[],
  now = Date.now(),
): PendingAgent[] {
  for (const [value, at] of starting) {
    if (now - at >= STARTING_GRACE_MS) starting.delete(value);
  }
  const byKey = new Map(
    terminals.map((terminal) => [
      `${terminal.address?.machine}:${terminal.address?.terminal_id}`,
      terminal,
    ]),
  );
  const claimed = new Set(
    agents.map(
      (agent) =>
        `${agent.terminal?.address?.machine}:${agent.terminal?.address?.terminal_id}`,
    ),
  );
  return pending.filter((agent) => {
    const value = key(agent.machine, agent.terminalId);
    if (claimed.has(value)) {
      starting.set(value, now);
      return false;
    }
    const terminal = byKey.get(value);
    if (terminal) {
      const status = terminal.runtime?.status ?? "";
      return ["starting", "running", "output_blocked", "finalizing"].includes(status);
    }
    // A creation reply can land before the next catalogue page includes its
    // terminal. Keep the local intent briefly instead of erasing it.
    return now - (agent.at ?? now) < PENDING_GRACE_MS;
  });
}
