import { finishedTerminal, type TerminalPhase } from "../shared/terminalLifecycle";
import { agentKey, terminalKey, unobserved } from "./catalogueRows";
import { labelFor, machineFor } from "./machineHandles";
import type { ProviderFeatures } from "../shared/protocol";

export type { ProviderFeatures } from "../shared/protocol";

export type MachineCapabilities = {
  create?: boolean;
  agent_start?: boolean;
  terminal_lifecycle?: boolean;
  stage_attachment?: boolean;
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
  providers?: ProviderOption[];
  terminals: unknown[];
  agents: unknown[];
}, previous: Pick<MachineView, "terminals" | "agents"> = { terminals: [], agents: [] }): MachineView {
  const methods = new Set(input.methods);
  const ended = new Set<string>();
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
    const agent = value as { lifecycle?: { state?: string }; terminal?: { address?: { terminal_id?: string } } } | null;
    return agent?.lifecycle?.state !== "exited" && !ended.has(agent?.terminal?.address?.terminal_id ?? "");
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
      create: methods.has("create"),
      agent_start: methods.has("agent_start"),
      terminal_lifecycle: methods.has("terminal"),
      stage_attachment: methods.has("stage_attachment"),
    },
    providers: input.providers ?? [],
    terminals: terminals.map((value) => terminalView(value, input.hub))
      .concat(unobserved(previous.terminals, input.terminals, terminalKey)),
    agents,
  };
}
