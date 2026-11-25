import { expect, spyOn, test } from "bun:test";
import type { HubClient } from "../../sdk/src/hub";
import * as hub from "../server/hub";
import * as pool from "../server/hubPool";
import * as route from "../server/routeCapabilities";
import { MachineObserver } from "../server/machineObserver";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("reachability changes recompute mutation capabilities", async () => {
  const client = {
    extensions: async () => [],
    request: async (method: string) =>
      method === "hello"
        ? { hello: { methods: ["get_platform_snapshot"] } }
        : { snapshot: { terminals: [], agents: [], truncated: { terminals: false, agents: false } } },
    supports: () => true,
  } as unknown as HubClient;
  using read = spyOn(hub, "read").mockImplementation((_hub, operation) => operation(client));
  using poolRead = spyOn(pool, "read").mockImplementation((_hub, operation) => operation(client));
  using probe = spyOn(route, "routeCapabilities").mockResolvedValue({
    known: true,
    lifecycle: true,
    terminal_read: true,
    terminal_write: true,
    agent_start: true,
  });
  const observer = new MachineObserver(crypto.randomUUID(), false, "Peer", () => {}, true);
  observer.refresh();
  await tick();
  expect(observer.snapshot.capabilities.create).toBe(true);
  observer.setReachable(false);
  expect(observer.snapshot.capabilities.create).toBe(false);
  expect(observer.snapshot.capabilities.agent_start).toBe(false);
});
