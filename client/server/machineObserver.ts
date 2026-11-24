import type { CollectedPages } from "../../sdk/src/pages.ts";
import { hasAgentBinding, terminalKey } from "./catalogueRows";
import { read } from "./hub";
import { machineView, type MachineView, type ProviderOption, type RouteCapabilities } from "./machineView";
import { providerOptions } from "./providerView";
import { routeCapabilities } from "./routeCapabilities";
import { listObservation, type MachineObservation } from "./machineObservation";

const POLL_MS = 2_500;
const HELLO_MS = 60_000;
const CONNECTING_FAILURES = 4;

export class MachineObserver {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = false;
  private methods: string[] = [];
  private providers: ProviderOption[] = [];
  private helloAt = 0;
  private revision = 0;
  private failures = 0;
  private configuredReachable: boolean;
  private route: RouteCapabilities | undefined;
  private readonly epoch = crypto.randomUUID();
  private view: MachineView;

  constructor(
    private readonly hub: string,
    private readonly entry: boolean,
    private readonly label: string | undefined,
    private readonly onChange: (view: MachineView) => void,
    reachable = true,
    private readonly entryHub = hub,
  ) {
    this.configuredReachable = reachable;
    this.route = entry
      ? { known: true, lifecycle: true, terminal_write: true, agent_start: true }
      : { known: false, lifecycle: false, terminal_write: false, agent_start: false };
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
    const hadRows = this.view.terminals.length > 0 || this.view.agents.length > 0;
    this.revision += 1;
    this.view = {
      ...this.view,
      reachable,
      freshness: reachable ? this.view.freshness : hadRows ? "stale" : "connecting",
      revision: this.revision,
    };
    this.onChange(this.view);
  }
  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }
  refresh(): void {
    void this.poll();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private async hello(): Promise<void> {
    if (this.methods.length && Date.now() - this.helloAt < HELLO_MS) return;
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
    if (!this.entry) {
      if (this.methods.includes("get_route_capabilities")) {
        try {
          this.route = await routeCapabilities(this.entryHub, this.hub);
        } catch {
          this.route = { known: false, lifecycle: false, terminal_write: false, agent_start: false };
        }
      } else {
        this.route = { known: false, lifecycle: false, terminal_write: false, agent_start: false };
      }
    }
    this.helloAt = Date.now();
  }
  private owns(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const item = value as any;
    const hub = item.address?.hub_id ?? item.cursor?.target?.address?.hub_id;
    return typeof hub !== "string" || hub === this.hub;
  }
  private own(page: CollectedPages, identified: (row: unknown) => unknown): CollectedPages {
    return { rows: page.rows.filter((row) => this.owns(row)), complete: page.complete && page.rows.every(identified) };
  }
  private async poll(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      await this.hello();
      const rows: MachineObservation = await listObservation(this.hub, this.methods);
      if (this.stopped) return;
      const terminals = this.own(rows.terminals, terminalKey);
      const agents = this.own(rows.agents, hasAgentBinding);
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
      this.view = {
        ...this.view,
        reachable: false,
        freshness: connecting ? "connecting" : hadRows ? "stale" : "unreachable",
        revision: this.revision,
      };
      this.onChange(this.view);
    } finally {
      this.busy = false;
    }
  }
}
