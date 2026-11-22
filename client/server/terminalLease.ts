import { HubError, TerminalSession, type SessionState } from "../../sdk/src/index.ts";
import { hubEndpoint } from "./hub";
import type { TerminalTarget } from "./target";

/** The actor's single Hub lease/input session; tabs only provide intents. */
export class TerminalLease {
  private session: TerminalSession | null = null;
  private taking: Promise<boolean> | null = null;
  private closed = false;
  private readonly connect: () => Promise<TerminalSession>;

  constructor(
    target: TerminalTarget,
    onChange: (state: SessionState) => void,
    onError: (error: Error) => void,
    connect?: () => Promise<TerminalSession>,
  ) {
    this.connect =
      connect ??
      (() => TerminalSession.open(hubEndpoint(), target, (state) => onChange(state), onError));
  }

  get state(): SessionState {
    return this.session?.state ?? "observing";
  }

  get connected(): boolean {
    return this.session?.connected ?? false;
  }

  take(): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    this.taking ??= this.takeFromHub().finally(() => { this.taking = null; });
    return this.taking;
  }

  private async takeFromHub(): Promise<boolean> {
    let session = await this.open();
    if (this.closed) return false;
    // A Hub restart closes the SDK's three private sockets without changing
    // the actor or its browser sockets. Rebuild them before reporting failure.
    if (!session.connected) {
      await this.release();
      session = await this.open();
    }
    try {
      return await this.attempt(session);
    } catch (error) {
      if (this.closed) return false;
      if (error instanceof HubError) throw error;
      await this.release();
      session = await this.open();
      return this.attempt(session);
    }
  }

  discardInput(): boolean {
    return this.session?.discardInput() ?? false;
  }

  enqueue(data: Uint8Array): void {
    if (this.session?.state === "controlled") this.session.enqueue(data);
  }

  resize(cols: number, rows: number): Promise<void> {
    return this.session?.resize(cols, rows) ?? Promise.resolve();
  }

  async release(): Promise<void> {
    const session = this.session;
    this.session = null;
    await session?.close();
  }

  /** Drops a session whose Hub sockets failed; the next take opens a fresh one. */
  drop(): Promise<void> {
    return this.release();
  }

  async close(): Promise<void> {
    this.closed = true;
    // A connect or acquire already on the wire can still return a session or grant.
    // The control request reports its own failure to the caller.
    await this.taking?.catch(() => false);
    await this.release();
  }

  private async attempt(session: TerminalSession): Promise<boolean> {
    if (this.closed) return false;
    if (session.state === "controlled") return true;
    const generation = await session.observe();
    if (this.closed || this.session !== session) return false;
    if (generation === null) await session.acquire();
    else await session.take(generation);
    return !this.closed && this.session === session && this.state === "controlled";
  }

  private async open(): Promise<TerminalSession> {
    if (this.closed) throw new Error("Terminal control is closed");
    this.session ??= await this.connect();
    return this.session;
  }
}
