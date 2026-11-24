import { read } from "./hub";
import type { RouteCapabilities } from "./machineView";

export async function routeCapabilities(entry: string, target: string): Promise<RouteCapabilities> {
  const reply = (await read(entry, (client) =>
    client.request("get_route_capabilities", { target }, entry),
  )) as { capabilities?: Partial<RouteCapabilities> };
  return {
    lifecycle: reply.capabilities?.lifecycle === true,
    terminal_write: reply.capabilities?.terminal_write === true,
    agent_start: reply.capabilities?.agent_start === true,
  };
}
