import { hasAgentBinding, terminalKey } from "./catalogueRows";
import { read } from "./hub";
import { machineView, type MachineView, type ProviderOption, type RouteCapabilities } from "./machineView";
import { providerOptions } from "./providerView";
import { refreshRoute, ROUTE_REFRESH_MS } from "./machineRoute";
import { listObservation, ownedPage, type MachineObservation } from "./machineObservation";

const HELLO_MS = 60_000;
const CONNECTING_FAILURES = 4;

export class MachineObserver {
  private lastFull = 0;
  private queued = false;
  private busy = false;
  private stopped = false;
  private methods: string[] = [];
  private providers: ProviderOption[] = [];
  private helloAt = 0;
  private revision = 0;
  private failures = 0;
  private configuredReachable: boolean;
  private route: RouteCapabilities | undefined;
  private routeAt = 0;
  private readonly epoch = crypto.randomUUID();
  private view: MachineView;

  constructor(
    private readonly hub: string,
    private readonly entry: boolean,
    private readonly label: string | undefined,
    private readonly onChange: (view: MachineView) => void,
    reachable = true,
  ) {
    this.configuredReachable = reachable;
    this.route = entry
      ? { known: true, lifecycle: true, terminal_read: true, terminal_write: true, agent_start: true }
      : { known: false, lifecycle: false, terminal_read: false, terminal_write: false, agent_start: false };
    this.view = machineView({
      hub,
      label,
      entry,
      reachable: entry || reachable,
      freshness: entry ? "live" : "connecting",
      epoch: this.epoch,
      revision: 0,
      methods: [],
      route: this.route,
      terminals: [],
      agents: [],
    });
  }
  get snapshot(): MachineView {
    return this.view;
  }
  setReachable(reachable: boolean): void {
    if (this.entry || this.configuredReachable === reachable) return;
    this.configuredReachable = reachable;
    if (!reachable && !this.entry) {
      this.route = { known: false, lifecycle: false, terminal_read: false, terminal_write: false, agent_start: false };
      this.routeAt = 0;
    }
    const hadRows = this.view.terminals.length > 0 || this.view.agents.length > 0;
    this.revision += 1;
    this.view = machineView({
      hub: this.hub,
      label: this.label,
      entry: this.entry,
      reachable: this.entry || reachable,
      freshness: reachable ? this.view.freshness : hadRows ? "stale" : "connecting",
      epoch: this.epoch,
      revision: this.revision,
      methods: this.methods,
      route: this.route,
      providers: this.providers,
      terminals: this.view.terminals,
      agents: this.view.agents,
    });
    this.onChange(this.view);
    if (reachable) this.refresh();
  }
  maintain(watching: boolean): void {
    if (!watching || this.view.freshness !== "live" || this.view.terminals.length || this.view.agents.length ||
        performance.now() - this.lastFull >= HELLO_MS) this.refresh();
    else if (!this.entry && Date.now() - this.routeAt >= ROUTE_REFRESH_MS) void this.poll(true);
  }
  refresh(): void { void this.poll(); }
  stop(): void { this.stopped = true; }
  private async checkRoute(): Promise<boolean> {
    if (this.entry || !this.configuredReachable) return false;
    const before = this.route!;
    const { route, observedAt } = await refreshRoute(this.hub, before, this.routeAt);
    if (this.stopped || before !== this.route) return false;
    this.route = route;
    this.routeAt = observedAt;
    return Object.keys(route).some(key => route[key as keyof RouteCapabilities] !== before[key as keyof RouteCapabilities]);
  }
  private async hello(): Promise<void> {
    const now = Date.now();
    if (!this.methods.length || now - this.helloAt >= HELLO_MS) {
      const reply = (await read(this.hub, (client) =>
        client.request("hello", {}, this.hub),
      )) as { hello?: { methods?: unknown } };
      this.methods = Array.isArray(reply.hello?.methods)
        ? reply.hello.methods.filter((value): value is string => typeof value === "string")
        : [];
      try {
        const extensions = await read(this.hub, (client) => client.extensions(this.hub));
        this.methods.push(...extensions);
      } catch {
        // An older peer may reject extension discovery. Its legacy catalogue remains usable.
      }
      if (this.methods.includes("list_providers")) {
        try {
          const providers = (await read(this.hub, (client) =>
            client.request("list_providers", {}, this.hub, 10_000),
          )) as { providers?: unknown };
          this.providers = providerOptions(providers.providers);
        } catch {
          // Keep the last advertised list; the machine view is already stale.
        }
      } else {
        this.providers = [];
      }
      this.helloAt = Date.now();
    }
    await this.checkRoute();
  }
  private async poll(routeOnly = false): Promise<void> {
    if (this.stopped || (!this.entry && !this.configuredReachable)) return;
    if (this.busy) { if (!routeOnly) this.queued = true; return; }
    this.busy = true;
    try {
      if (routeOnly && !await this.checkRoute()) return;
      await this.hello();
      const rows: MachineObservation = await listObservation(this.hub, this.methods);
      if (this.stopped) return;
      const terminals = ownedPage(this.hub, rows.terminals, terminalKey);
      const agents = ownedPage(this.hub, rows.agents, hasAgentBinding);
      this.lastFull = performance.now();
      this.failures = 0;
      this.revision += 1;
      this.view = machineView({
        hub: this.hub,
        label: this.label,
        entry: this.entry,
        reachable: this.entry || this.configuredReachable,
        freshness: this.entry || this.configuredReachable
          ? terminals.complete && agents.complete ? "live" : "stale"
          : "connecting",
        epoch: this.epoch,
        revision: this.revision,
        methods: this.methods,
        route: this.route,
        providers: this.providers,
        terminals: terminals.rows,
        terminalsComplete: terminals.complete,
        agents: agents.rows,
      }, {
        terminals: terminals.complete ? [] : this.view.terminals,
        agents: agents.complete ? [] : this.view.agents,
      });
      this.onChange(this.view);
    } catch (error) {
      if (this.stopped) return;
      this.failures += 1;
      this.revision += 1;
      const hadRows = this.view.terminals.length > 0 || this.view.agents.length > 0;
      const connecting = !hadRows && !this.entry && this.failures < CONNECTING_FAILURES;
      if (!this.entry) {
        this.route = { known: false, lifecycle: false, terminal_read: false, terminal_write: false, agent_start: false };
        this.routeAt = 0;
      }
      this.view = machineView({
        hub: this.hub,
        label: this.label,
        entry: this.entry,
        reachable: false,
        freshness: connecting ? "connecting" : hadRows ? "stale" : "unreachable",
        epoch: this.epoch,
        revision: this.revision,
        methods: this.methods,
        route: this.route,
        providers: this.providers,
        terminals: this.view.terminals,
        agents: this.view.agents,
      });
      this.onChange(this.view);
    } finally {
      this.busy = false;
      if (this.queued) { this.queued = false; await this.poll(); }
    }
  }
}
