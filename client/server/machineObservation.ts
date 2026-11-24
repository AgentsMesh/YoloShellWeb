import { observePages, type CollectedPages } from "../../sdk/src/pages.ts";
import { read } from "./hub";

export type MachineObservation = { terminals: CollectedPages; agents: CollectedPages };

export async function listObservation(hub: string, methods: string[]): Promise<MachineObservation> {
  const snapshot = await readSnapshot(hub, methods);
  if (snapshot) return snapshot;
  const terminals = await observePages("terminals", async (after) =>
    (await read(hub, (client) => client.request("list", { include_archived: false, after }, hub))) as Record<string, unknown>,
  );
  const agents = await observePages("agents", async (after) =>
    (await read(hub, (client) => client.request("list_agents", { after }, hub))) as Record<string, unknown>,
  );
  return { terminals, agents };
}

async function readSnapshot(hub: string, methods: string[]): Promise<MachineObservation | null> {
  if (!methods.includes("get_platform_snapshot")) return null;
  const reply = (await read(hub, (client) => client.request("get_platform_snapshot", {
    request: { schema_version: 1, terminal_limit: 128, agent_limit: 128, run_limit: 1, workspace_limit: 1 },
  }, hub))) as { snapshot?: { terminals?: unknown[]; agents?: unknown[]; truncated?: Record<string, unknown> } };
  const snapshot = reply.snapshot;
  if (!snapshot || !Array.isArray(snapshot.terminals) || !Array.isArray(snapshot.agents) ||
      snapshot.truncated?.terminals !== false || snapshot.truncated?.agents !== false) return null;
  return { terminals: { rows: snapshot.terminals, complete: true }, agents: { rows: snapshot.agents, complete: true } };
}
