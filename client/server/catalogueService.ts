import { read, hubId } from "./hubPool";
import { entryMachine, labelFor, machineFor } from "./machineHandles";
import { CatalogueWatch } from "./catalogueWatch";
import { MachineObserver } from "./machineObserver";
import { CataloguePublisher, type CatalogueEvent } from "./cataloguePublisher";
import type { MachineView } from "./machineView";
import { sanitize } from "./sanitize";

type Listener = (event: CatalogueEvent) => void;

const DISCOVERY_MS = 4_000;

export class CatalogueService {
  private readonly entry = hubId();
  private readonly publisher = new CataloguePublisher(entryMachine());
  private readonly observers = new Map<string, MachineObserver>();
  private readonly listeners = new Set<Listener>();
  private discovery: ReturnType<typeof setInterval> | null = null;
  private watch: CatalogueWatch | null = null;
  private discoveryRequest: Promise<void> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.start();
    const current = this.publisher.latest();
    if (current) listener(this.safe({ kind: "snapshot", inventory: current }));
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && !this.idle) {
        this.idle = setTimeout(() => this.stop(), 30_000);
      }
    };
  }

  latest(): unknown {
    return this.publisher.latest();
  }

  /** Hub destinations currently observed, for scoped on-demand reads. */
  machines(): { hub: string; machine: string; label: string; reachable: boolean }[] {
    return [...this.observers.entries()].map(([hub, observer]) => ({
      hub,
      machine: machineFor(hub),
      label: labelFor(hub),
      reachable: observer.snapshot?.reachable ?? false,
    }));
  }

  /** Repair one subscriber without broadcasting a snapshot to every tab. */
  resync(): CatalogueEvent | null {
    const event = this.publisher.forceSnapshot();
    return event ? this.safe(event) : null;
  }

  invalidate(): void {
    for (const observer of this.observers.values()) observer.refresh();
    void this.discover();
  }

  private start(): void {
    if (this.discovery) return;
    this.discovery = setInterval(() => void this.discover(), DISCOVERY_MS);
    this.watch = new CatalogueWatch(
      changed => { for (const [id, observer] of this.observers) if (!changed || changed.has(id)) observer.refresh(); },
      watching => { for (const observer of this.observers.values()) observer.maintain(watching); },
    );
    void this.watch.run();
    this.ensure(this.entry);
    void this.discover();
  }

  private stop(): void {
    if (this.discovery) clearInterval(this.discovery);
    this.discovery = null;
    this.watch?.stop();
    this.watch = null;
    this.discoveryRequest = null;
    for (const observer of this.observers.values()) observer.stop();
    this.observers.clear();
    this.publisher.reset();
    this.idle = null;
  }

  private async discover(): Promise<void> {
    const watch = this.watch;
    if (!watch) return;
    if (this.discoveryRequest) return this.discoveryRequest;
    const job = this.readMachines(watch);
    this.discoveryRequest = job;
    try { await job; } finally { if (this.discoveryRequest === job) this.discoveryRequest = null; }
  }

  private async readMachines(watch: CatalogueWatch): Promise<void> {
    this.ensure(this.entry);
    try {
      const reply = (await read(this.entry, (client) => client.listHubs())) as {
        hubs?: unknown;
      };
      if (watch !== this.watch) return;
      const hubs = Array.isArray(reply.hubs) ? reply.hubs : [];
      for (const value of hubs) {
        if (typeof value !== "object" || value === null) continue;
        const hub = (value as { hub_id?: unknown }).hub_id;
        if (typeof hub === "string") this.ensure(hub, value as Record<string, unknown>);
      }
    } catch {
      // The entry observer already reports the Home machine as unavailable.
    }
  }

  private ensure(hub: string, summary: Record<string, unknown> = {}): void {
    const reachable = summary.reachable === true;
    const existing = this.observers.get(hub);
    if (existing) {
      existing.setReachable(reachable);
      return;
    }
    const label = typeof summary.label === "string" ? summary.label : undefined;
    const observer = new MachineObserver(
      hub,
      hub === this.entry,
      label,
      (view) => this.publish(view),
      hub === this.entry || reachable,
    );
    this.observers.set(hub, observer);
    observer.refresh();
  }

  private publish(view: MachineView): void {
    const views = [...this.observers.values()].map((observer) => observer.snapshot);
    const event = this.publisher.publish(views, view);
    if (!event) return;
    this.broadcast(this.safe(event));
  }

  private broadcast(event: CatalogueEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private safe(event: CatalogueEvent): CatalogueEvent {
    return sanitize(event) as CatalogueEvent;
  }
}

let service: CatalogueService | null = null;

export function getCatalogue(): CatalogueService {
  if (!service) service = new CatalogueService();
  return service;
}
