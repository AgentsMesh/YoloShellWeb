import { finishedTerminal, type TerminalPhase } from "../shared/terminalLifecycle";
import { agentKey, terminalKey, unobserved } from "./catalogueRows";
import { labelFor, machineFor } from "./machineHandles";
import type { ProviderFeatures } from "../shared/protocol";

export type { ProviderFeatures } from "../shared/protocol";

export type MachineCapabilities = {
  /** Route rights were resolved by the entry Hub for this machine. */
  known?: boolean;
  create?: boolean;
  agent_start?: boolean;
  terminal_read?: boolean;
  terminal_lifecycle?: boolean;
  stage_attachment?: boolean;
};
export type RouteCapabilities = {
  known: boolean;
  lifecycle: boolean;
  terminal_read: boolean;
  terminal_write: boolean;
  agent_start: boolean;
};
export type ProviderOption = {
  provider_id: string;
  display_name: string;
  available: boolean;
  features?: ProviderFeatures;
};
export type MachineView = {
  machine: string;
  label: string;
  entry: boolean;
  reachable: boolean;
  freshness: "live" | "stale" | "connecting" | "unreachable";
  epoch: string;
  revision: number;
  capabilities: MachineCapabilities;
  providers: ProviderOption[];
  terminals: unknown[];
  agents: unknown[];
};

function address(value: unknown, hub: string, key: "terminal_id" | "agent_id") {
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, unknown>;
  const id = item[key];
  if (typeof id !== "string") return { machine: machineFor(hub) };
  return { machine: machineFor(hub), [key]: id };
}

export function terminalView(value: unknown, hub: string): unknown {
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, any>;
  return {
    ...item,
    address: address(item.address, hub, "terminal_id"),
    agent: item.agent
      ? {
          ...item.agent,
          address: item.agent.address?.agent_id
            ? { agent_id: item.agent.address.agent_id }
            : undefined,
        }
      : null,
    runtime: item.runtime
      ? {
          ...item.runtime,
          target: item.runtime.target
            ? {
                ...item.runtime.target,
                address: address(item.runtime.target.address, hub, "terminal_id"),
              }
            : undefined,
        }
      : item.runtime,
  };
}

function agentView(value: unknown, hub: string): unknown {
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, any>;
  const target = item.cursor?.target ?? {};
  return {
    ...item,
    cursor: {
      ...item.cursor,
      target: {
        ...target,
        address: address(target.address, hub, "agent_id"),
      },
    },
    terminal: item.terminal
      ? {
          ...item.terminal,
          address: address(item.terminal.address, hub, "terminal_id"),
        }
      : item.terminal,
  };
}

export function machineView(input: {
  hub: string;
  label?: string;
  entry: boolean;
  reachable: boolean;
  freshness: MachineView["freshness"];
  epoch: string;
  revision: number;
  methods: string[];
  route?: RouteCapabilities;
  providers?: ProviderOption[];
  terminals: unknown[];
  agents: unknown[];
  terminalsComplete?: boolean;
}, previous: Pick<MachineView, "terminals" | "agents"> = { terminals: [], agents: [] }): MachineView {
  const methods = new Set(input.methods);
  const ended = new Set<string>();
  const present = new Set(input.terminals.map(terminalKey));
  const terminals = input.terminals.filter((value) => {
    const row = value as (TerminalPhase & { address?: { terminal_id?: string } }) | null;
    if (!row) return false;
    if (!row.archived && !finishedTerminal(row)) return true;
    if (row.address?.terminal_id) ended.add(row.address.terminal_id);
    return false;
  });
  const observed = input.agents.map((value) => agentView(value, input.hub));
  const retained = unobserved(previous.agents, observed, agentKey)
    .map((value) => ({ ...value as object, freshness: "stale" }));
  const agents = [...observed, ...retained].filter((value) => {
    const agent = value as { lifecycle?: { state?: string }; freshness?: string; reachability?: string;
      source?: string; terminal?: { address?: { terminal_id?: string } } } | null;
    const id = agent?.terminal?.address?.terminal_id;
    if (agent?.lifecycle?.state === "exited" || ended.has(id ?? "")) return false;
    const historical = agent?.source === "provider_hook" && agent.lifecycle?.state === "unknown" &&
      agent.freshness === "stale" && agent.reachability === "unreachable";
    return !(input.terminalsComplete && id && !present.has(id) && historical);
  });
  return {
    machine: machineFor(input.hub),
    label: labelFor(input.hub, input.label),
    entry: input.entry,
    reachable: input.reachable,
    freshness: input.freshness,
    epoch: input.epoch,
    revision: input.revision,
    capabilities: {
      known: input.entry || input.route?.known === true,
      create: input.entry
        ? methods.has("create")
        : input.route?.known === true && input.reachable && input.freshness === "live" && input.route.lifecycle,
      agent_start: input.entry
        ? methods.has("agent_start")
        : input.route?.known === true && input.reachable && input.freshness === "live" && input.route.agent_start,
      terminal_read: input.entry
        ? methods.has("attach")
        : input.route?.known === true && input.reachable && input.freshness === "live" && input.route.terminal_read,
      terminal_lifecycle: input.entry
        ? methods.has("terminal")
        : input.route?.known === true && input.reachable && input.freshness === "live" && input.route.lifecycle,
      stage_attachment: input.entry
        ? methods.has("stage_attachment")
        : input.route?.known === true && input.reachable && input.freshness === "live" && input.route.terminal_write,
    },
    providers: input.providers ?? [],
    terminals: terminals.map((value) => terminalView(value, input.hub))
      .concat(unobserved(previous.terminals, input.terminals, terminalKey)),
    agents,
  };
}
