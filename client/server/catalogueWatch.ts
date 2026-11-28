import { HubClient } from "../../sdk/src/hub";
import { hubEndpoint } from "./hubPool";
import { uuid } from "./validate";

const METHOD = "watch_catalogues";
const POLL_MS = 2_500;
const WAIT_MS = 20_000;
const REPROBE_MS = 60_000;
const IO_MARGIN_MS = 5_000;

type WatchClient = Pick<HubClient, "hubId" | "extensions" | "request" | "close">;
type Observation = { epoch: string; cursor: string; origins: Map<string, string> | null };

/** All machines and browser tabs share one entry connection and one fallback timer. */
export class CatalogueWatch {
  private client: WatchClient | null = null;
  private stopped = false;
  private following = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cancelDelay?: () => void;

  constructor(
    private readonly refresh: (changed: Set<string> | null) => void,
    private readonly maintain: (watching: boolean) => void,
    private readonly connect: () => Promise<WatchClient> = () => HubClient.connect(hubEndpoint()),
  ) {}

  async run(): Promise<void> {
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => this.maintain(this.following), POLL_MS);
    while (!this.stopped) {
      let retry = POLL_MS;
      try {
        const client = await this.connect();
        this.client = client;
        if (this.stopped) return this.closeClient();
        if ((await client.extensions()).includes(METHOD)) await this.follow(client);
        else retry = REPROBE_MS;
      } catch {
        // Timed reads maintain the view until the entry can establish a new watch.
      } finally {
        this.following = false;
        this.closeClient();
      }
      if (!this.stopped) await this.delay(retry);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.closeClient();
    this.cancelDelay?.();
  }

  private async follow(client: WatchClient): Promise<void> {
    let previous = await this.wait(client, null, 0);
    if (this.stopped) return;
    this.following = true;
    // Capture the cursor first so a publication racing the initial reads is replayed.
    this.refresh(null);
    while (!this.stopped) {
      const next = await this.wait(client, previous.cursor, WAIT_MS);
      if (this.stopped) return;
      if (!next.origins) continue;
      const old = previous.origins!;
      const changed = new Set([...old.keys(), ...next.origins.keys()].filter(
        hub => old.get(hub) !== next.origins!.get(hub),
      ));
      if (previous.epoch !== next.epoch) this.refresh(null);
      else if (changed.size) this.refresh(changed);
      previous = next;
    }
  }

  private async wait(client: WatchClient, after: string | null, wait_ms: number): Promise<Observation> {
    const reply = await client.request(METHOD, { after, wait_ms }, client.hubId,
      wait_ms + IO_MARGIN_MS) as Record<string, unknown>;
    const cursor = uuid(reply.cursor), epoch = uuid(reply.epoch);
    if (cursor === after && reply.origins == null) return { epoch, cursor, origins: null };
    if (cursor === after || !reply.origins || typeof reply.origins !== "object" || Array.isArray(reply.origins)) {
      throw new Error("Invalid catalogue cursors from the entry Hub");
    }
    const origins = new Map(Object.entries(reply.origins).map(([id, value]) => [uuid(id), uuid(value)]));
    return { epoch, cursor, origins };
  }

  private closeClient(): void {
    this.client?.close();
    this.client = null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.cancelDelay = undefined; resolve(); };
      const timer = setTimeout(done, ms);
      this.cancelDelay = done;
    });
  }
}
