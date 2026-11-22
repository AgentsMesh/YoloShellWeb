import type { ServerWebSocket } from "bun";
import type { TerminalTarget } from "./target";
import { TerminalControlFanout } from "./terminalControlFanout";
import { TerminalLease } from "./terminalLease";
import { TerminalStream } from "./terminalStream";

const IDLE_MS = 15_000;

/** One upstream PTY stream/lease shared by every browser tab for an epoch. */
export class TerminalActor {
  private readonly stream: TerminalStream;
  private readonly control = new TerminalControlFanout(() => this.lease.discardInput());
  private readonly lease: TerminalLease;
  private controlQueue: Promise<void> = Promise.resolve();
  private idle: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly target: TerminalTarget,
    private readonly onIdle: () => void,
  ) {
    this.stream = new TerminalStream(target, () => this.close());
    this.lease = new TerminalLease(
      target,
      (state) => this.onLease(state),
      (error) => this.onLeaseError(error),
    );
  }

  attachOutput(ws: ServerWebSocket<unknown>): void {
    this.cancelIdle();
    this.stream.attach(ws);
  }

  history(limit: number): { data: Uint8Array; truncated: boolean } | null {
    return this.stream.history(limit);
  }

  detachOutput(ws: ServerWebSocket<unknown>): void {
    this.stream.detach(ws);
    this.maybeIdle();
  }

  attachControl(ws: ServerWebSocket<unknown>, clientId: string): void {
    this.cancelIdle();
    this.control.add(ws, clientId);
  }

  detachControl(ws: ServerWebSocket<unknown>, clientId: string): void {
    if (this.closed) return;
    const wasController = this.control.remove(ws, clientId);
    if (wasController || this.control.count === 0) {
      this.enqueueControl(async () => {
        if (!this.control.controlledBy) await this.releaseLease();
      });
    }
    this.maybeIdle();
  }

  message(ws: ServerWebSocket<unknown>, clientId: string, message: string | Uint8Array): void {
    if (this.closed || !this.control.has(ws, clientId)) return;
    if (message instanceof Uint8Array) {
      if (this.control.controlledBy === clientId) this.lease.enqueue(message);
      return;
    }
    let value: { type?: unknown; cols?: unknown; rows?: unknown };
    try {
      value = JSON.parse(message);
    } catch {
      return;
    }
    if (value.type === "take") this.enqueueControl(() => this.take(ws, clientId));
    else if (value.type === "release") this.enqueueControl(() => this.release(clientId));
    else if (value.type === "resize" && typeof value.cols === "number" && typeof value.rows === "number") {
      if (this.control.controlledBy === clientId) {
        void this.lease
          .resize(value.cols, value.rows)
          .then(() => this.stream.resize(value.cols as number, value.rows as number));
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelIdle();
    this.stream.close();
    this.control.close();
    void this.lease.close();
    this.onIdle();
  }

  /**
   * Hand the writer lease to a prompt from the tab that currently controls
   * this terminal. A different tab is a real conflict and is left alone.
   */
  async releaseForPrompt(clientId: string): Promise<void> {
    if (this.closed) return;
    await this.queueControl(async () => {
      if (this.closed || !this.control.owns(clientId)) return;
      this.control.release();
      await this.releaseLease();
    });
  }

  private enqueueControl(operation: () => Promise<void>): void {
    void this.queueControl(operation);
  }

  private queueControl(operation: () => Promise<void>): Promise<void> {
    this.controlQueue = this.controlQueue.then(operation).catch((error) => {
      this.control.error(error instanceof Error ? error.message : "Terminal control failed");
    });
    return this.controlQueue;
  }

  private async take(ws: ServerWebSocket<unknown>, clientId: string): Promise<void> {
    if (this.closed || !this.control.has(ws, clientId)) return;
    if (this.control.controlledBy === clientId && this.lease.state === "controlled") {
      this.control.assign(clientId);
      return;
    }
    this.control.acquire(clientId);
    try {
      if (this.lease.state !== "controlled") {
        const held = await this.lease.take();
        if (this.closed) return;
        if (!held) throw new Error("Terminal control is unavailable");
      }
      if (!this.control.has(ws, clientId)) {
        await this.releaseLease();
        return;
      }
      this.control.assign(clientId);
    } catch (error) {
      if (this.closed) return;
      this.control.deny(clientId, error instanceof Error ? error.message : "Terminal control failed");
      if (this.lease.state !== "controlled") this.control.observe();
    }
  }

  private async release(clientId: string): Promise<void> {
    if (this.control.controlledBy !== clientId) return;
    this.control.release();
    await this.releaseLease();
  }

  private async releaseLease(): Promise<void> {
    await this.lease.release();
    if (this.control.count > 0) this.control.observe();
  }

  private onLeaseError(error: Error): void {
    if (this.closed) return;
    this.control.error(error.message);
    // A dead private Hub session must not leave every tab "controlled" while
    // input is dropped by the actor; drop it so the next keystroke reopens.
    if (this.lease.connected) return;
    void this.lease.drop();
    this.control.lost();
  }

  private onLease(state: string): void {
    if (this.closed) return;
    if (state === "lost") this.control.lost();
    else if (state === "observing" || state === "released") this.control.observe();
  }

  private maybeIdle(): void {
    if (this.idle || this.closed) return;
    if (this.stream.count > 0 || this.control.count > 0) return;
    this.idle = setTimeout(() => this.close(), IDLE_MS);
  }

  private cancelIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
  }
}
