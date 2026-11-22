import { observePages, type CollectedPages } from "../../sdk/src/pages.ts";
import { hasAgentBinding, terminalKey } from "./catalogueRows";
import { read } from "./hub";
import { machineView, type MachineView, type ProviderOption } from "./machineView";
import { providerOptions } from "./providerView";

const POLL_MS = 2_500;
const HELLO_MS = 60_000;
type Observation = { terminals: CollectedPages; agents: CollectedPages };

export class MachineObserver {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = false;
  private methods: string[] = [];
  private providers: ProviderOption[] = [];
  private helloAt = 0;
  private revision = 0;
  private readonly epoch = crypto.randomUUID();
  private view: MachineView;

  constructor(
    private readonly hub: string,
    private readonly entry: boolean,
    private readonly label: string | undefined,
    private readonly onChange: (view: MachineView) => void,
  ) {
    this.view = machineView({
      hub,
      label,
      entry,
      reachable: true,
      freshness: "live",
      epoch: this.epoch,
      revision: 0,
      methods: [],
      terminals: [],
      agents: [],
    });
  }

  get snapshot(): MachineView {
    return this.view;
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

  private async readSnapshot(): Promise<Observation | null> {
    if (!this.methods.includes("get_platform_snapshot")) return null;
    const reply = (await read(this.hub, (client) =>
      client.request(
        "get_platform_snapshot",
        {
          request: {
            schema_version: 1,
            terminal_limit: 128,
            agent_limit: 128,
            run_limit: 1,
            workspace_limit: 1,
          },
        },
        this.hub,
      ),
    )) as { snapshot?: { terminals?: unknown[]; agents?: unknown[]; truncated?: Record<string, unknown> } };
    const snapshot = reply.snapshot;
    if (!snapshot || !Array.isArray(snapshot.terminals) || !Array.isArray(snapshot.agents) ||
        snapshot.truncated?.terminals !== false || snapshot.truncated?.agents !== false) return null;
    return {
      terminals: { rows: snapshot.terminals, complete: true },
      agents: { rows: snapshot.agents, complete: true },
    };
  }

  private async list(): Promise<Observation> {
    const snapshot = await this.readSnapshot();
    if (snapshot) return snapshot;
    const terminals = await observePages("terminals", async (after) => {
      return (await read(this.hub, (client) =>
        client.request("list", { include_archived: false, after }, this.hub),
      )) as Record<string, unknown>;
    });
    const agents = await observePages("agents", async (after) => {
      return (await read(this.hub, (client) =>
        client.request("list_agents", { after }, this.hub),
      )) as Record<string, unknown>;
    });
    return { terminals, agents };
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      await this.hello();
      const rows = await this.list();
      if (this.stopped) return;
      const terminals = this.own(rows.terminals, terminalKey);
      const agents = this.own(rows.agents, hasAgentBinding);
      this.revision += 1;
      this.view = machineView({
        hub: this.hub,
        label: this.label,
        entry: this.entry,
        reachable: true,
        freshness: terminals.complete && agents.complete ? "live" : "stale",
        epoch: this.epoch,
        revision: this.revision,
        methods: this.methods,
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
      this.revision += 1;
      const hadRows = this.view.terminals.length > 0 || this.view.agents.length > 0;
      this.view = {
        ...this.view,
        reachable: false,
        freshness: hadRows ? "stale" : "unreachable",
        revision: this.revision,
      };
      this.onChange(this.view);
    } finally {
      this.busy = false;
    }
  }
}
