import type { RouteCapabilities } from "./machineView";
import * as pool from "./hubPool";

export async function routeCapabilities(target: string): Promise<RouteCapabilities | null> {
  const entry = pool.hubId();
  return pool.read(entry, async (client) => {
    const methods = new Set<string>();
    if (typeof client.supports === "function") {
      for (const method of ["get_route_capabilities", "create", "attach", "read_terminal_text", "lease", "agent_start"]) {
        if (client.supports(method)) methods.add(method);
      }
    }
    try {
      for (const method of await client.extensions(entry)) methods.add(method);
    } catch {
      // Older Hubs may not expose extension discovery.
    }
    const supports = (method: string): boolean => methods.has(method);
    if (!supports("get_route_capabilities")) {
      return target === entry
        ? {
            known: true,
            lifecycle: supports("create"),
            terminal_read: supports("attach") || supports("read_terminal_text"),
            terminal_write: supports("lease"),
            agent_start: supports("agent_start"),
          }
        : null;
    }
    const reply = (await client.request("get_route_capabilities", { target }, entry)) as {
      capabilities?: Partial<RouteCapabilities>;
    };
    return {
      known: true,
      lifecycle: reply.capabilities?.lifecycle === true,
      terminal_read: reply.capabilities?.terminal_read === true,
      terminal_write: reply.capabilities?.terminal_write === true,
      agent_start: reply.capabilities?.agent_start === true,
    };
  });
}
