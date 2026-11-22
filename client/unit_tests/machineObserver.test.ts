import { expect, spyOn, test } from "bun:test";
import type { HubClient } from "../../sdk/src/hub";
import * as hub from "../server/hub";
import { MachineObserver } from "../server/machineObserver";

const terminal = (terminal_id: string, status = "running") => ({ address: { terminal_id }, runtime: { status } });
const agent = (id: string) => ({
  cursor: { target: { address: { agent_id: id }, execution_id: "e" } },
  terminal: { address: { terminal_id: id }, runtime_epoch: "r" }, lifecycle: { state: "running" }, freshness: "current",
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("bounded or malformed reads retain previously seen rows and publish available rows on a reachable machine", async () => {
  let phase = 0;
  const known = ["seen", "outside", "exited"];
  const request = async (method: string, params: any) => {
    switch (method) {
      case "hello": return { hello: { methods: ["get_platform_snapshot", "agent_start"] } };
      case "get_platform_snapshot":
        if (phase === 0) return { snapshot: {
          terminals: known.map((id) => terminal(id)), agents: known.map(agent), truncated: { terminals: false, agents: false },
        } };
        return { snapshot: { terminals: [], agents: [] } };
      case "list":
        if (phase === 1) return { terminals: params.after === null ? [terminal("seen"), terminal("exited", "exited")] : [], next: 1 };
        return { terminals: [], next: null };
      case "list_agents":
        if (phase === 1) return params.after === null ? { agents: [agent("seen"), agent("new")], next: 1 } : { next: null };
        if (phase === 2) return { agents: [{ cursor: { target: { address: { agent_id: "seen" } } } }], next: null };
        return { agents: [], next: null };
      default: throw new Error(method);
    }
  };
  const client = { request, extensions: async () => [] } as unknown as HubClient;
  using read = spyOn(hub, "read").mockImplementation((_hub, operation) => operation(client));
  const observer = new MachineObserver(crypto.randomUUID(), false, "Peer", () => {});
  observer.refresh();
  await tick();
  expect(observer.snapshot).toMatchObject({ revision: 1, reachable: true, freshness: "live" });
  phase = 1;
  observer.refresh();
  await tick();
  const partial = observer.snapshot;
  expect(partial).toMatchObject({ revision: 2, reachable: true, freshness: "stale", capabilities: { agent_start: true } });
  expect(partial.terminals.map((row: any) => row.address.terminal_id)).toEqual(["seen", "outside"]);
  expect(partial.agents.map((row: any) => [row.cursor.target.address.agent_id, row.freshness])).toEqual([
    ["seen", "current"], ["new", "current"], ["outside", "stale"],
  ]);
  phase = 2;
  observer.refresh();
  await tick();
  expect(observer.snapshot).toMatchObject({ revision: 3, reachable: true, freshness: "stale" });
  phase = 3;
  observer.refresh();
  await tick();
  expect(observer.snapshot).toMatchObject({ revision: 4, reachable: true, freshness: "live", terminals: [], agents: [] });
});

test("a stopped observer cannot publish an in-flight result after rediscovery", async () => {
  const readStarted = Promise.withResolvers<void>();
  const delayed = Promise.withResolvers<{ terminals: never[]; next: null }>();
  const client = {
    extensions: async () => [],
    request: async (method: string) => {
      if (method === "hello") return { hello: { methods: ["list"] } };
      if (method === "list_agents") return { agents: [], next: null };
      readStarted.resolve();
      return delayed.promise;
    },
  } as unknown as HubClient;
  using read = spyOn(hub, "read").mockImplementation((_hub, operation) => operation(client));
  const revisions: number[] = [];
  const observer = new MachineObserver(crypto.randomUUID(), false, "Peer", (view) => revisions.push(view.revision));
  observer.refresh();
  await readStarted.promise;
  observer.stop();
  delayed.resolve({ terminals: [], next: null });
  await tick();
  expect(revisions).toEqual([]);
});
