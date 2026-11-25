import type { RouteCapabilities } from "./machineView";
import { routeCapabilities } from "./routeCapabilities";

export const ROUTE_REFRESH_MS = 10_000;

function unknownRoute(): RouteCapabilities {
  return {
    known: false,
    lifecycle: false,
    terminal_read: false,
    terminal_write: false,
    agent_start: false,
  };
}

export async function refreshRoute(
  target: string,
  current: RouteCapabilities,
  observedAt: number,
): Promise<{ route: RouteCapabilities; observedAt: number }> {
  if (Date.now() - observedAt < ROUTE_REFRESH_MS) {
    return { route: current, observedAt };
  }
  let route: RouteCapabilities;
  try {
    route = (await routeCapabilities(target)) ?? unknownRoute();
  } catch {
    route = unknownRoute();
  }
  return { route, observedAt: Date.now() };
}
