import { expect, spyOn, test } from "bun:test";
import type { HubClient } from "../../sdk/src/hub";
import * as pool from "../server/hubPool";
import { routeCapabilities } from "../server/routeCapabilities";

const ENTRY = crypto.randomUUID();
const TARGET = crypto.randomUUID();
process.env.YOLO_HUB_ID = ENTRY;
process.env.YOLO_HUB_SOCKET = "/tmp/yolo-route-capabilities-test.sock";

test("discovers extension route capabilities from an entry Hub", async () => {
  const client = {
    supports: () => false,
    extensions: async () => ["get_route_capabilities"],
    request: async () => ({ capabilities: {
      lifecycle: true,
      terminal_read: true,
      terminal_write: true,
      agent_start: true,
    } }),
  } as unknown as HubClient;
  using read = spyOn(pool, "read").mockImplementation((_hub, operation) => operation(client));
  await expect(routeCapabilities(TARGET)).resolves.toEqual({
    known: true,
    lifecycle: true,
    terminal_read: true,
    terminal_write: true,
    agent_start: true,
  });
  expect(read).toHaveBeenCalled();
});
