import { HubClient } from "./hub";
import { HubError } from "./hubError.ts";
import type { LeaseController } from "./leaseController";

// Match the Rust terminal relay's block size for each acknowledged PTY write.
const INPUT_BLOCK_BYTES = 8 * 1024;

export class InputQueue {
  private readonly chunks: Uint8Array[] = [];
  private activeRevision?: number;
  private revision = 0;

  constructor(
    private readonly input: HubClient,
    private readonly control: HubClient,
    private readonly lease: LeaseController,
    private readonly onError: (error: Error) => void,
  ) {}

  enqueue(data: Uint8Array): void {
    for (let offset = 0; offset < data.byteLength; offset += INPUT_BLOCK_BYTES) {
      const chunk = data.subarray(offset, Math.min(offset + INPUT_BLOCK_BYTES, data.byteLength));
      if (chunk.byteLength) this.chunks.push(Uint8Array.from(chunk));
    }
    if (this.activeRevision === undefined) void this.flush();
  }

  /** An already issued mutation settles once. A new writer starts with fresh input. */
  discardPending(): boolean {
    const queued = this.chunks.length > 0 || this.activeRevision === this.revision;
    this.revision++;
    this.chunks.length = 0;
    return queued;
  }

  async resize(cols: number, rows: number): Promise<void> {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 1000 || rows > 1000) {
      this.onError(new Error("Terminal size is invalid"));
      return;
    }
    const grant = this.lease.currentGrant;
    if (this.lease.state !== "controlled" || !grant) {
      this.onError(new Error("Terminal control is not held"));
      return;
    }
    try {
      await this.control.request(
        "resize",
        { request: { request_id: crypto.randomUUID(), grant, size: { cols, rows } } },
        this.lease.origin,
      );
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error("Terminal resize failed"));
    }
  }

  private async flush(): Promise<void> {
    try {
      while (this.chunks.length) {
        const revision = this.revision;
        this.activeRevision = revision;
        try {
          await this.send(this.takeBatch(), revision);
        } catch (error) {
          if (revision === this.revision) {
            this.chunks.length = 0;
            this.onError(error instanceof Error ? error : new Error("Terminal input failed"));
          }
        }
      }
    } finally {
      this.activeRevision = undefined;
    }
  }

  /**
   * Coalesce small keystrokes behind an in-flight write, up to one PTY block.
   */
  private takeBatch(): Uint8Array {
    const first = this.chunks.shift()!;
    if (first.byteLength >= INPUT_BLOCK_BYTES) return first;
    const parts = [first];
    let size = first.byteLength;
    while (this.chunks.length) {
      const next = this.chunks[0];
      if (size + next.byteLength > INPUT_BLOCK_BYTES) break;
      parts.push(this.chunks.shift()!);
      size += next.byteLength;
    }
    if (parts.length === 1) return first;
    const batch = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      batch.set(part, offset);
      offset += part.byteLength;
    }
    return batch;
  }

  /** A rejected lease is retried once after acquiring; delivery failures are not. */
  private async send(data: Uint8Array, revision: number): Promise<void> {
    if (this.lease.state !== "controlled" || !this.lease.currentGrant) {
      if (!(await this.recover(false))) throw new Error("Terminal control is not held");
    }
    if (revision !== this.revision) return;
    try {
      await this.deliver(data);
    } catch (error) {
      if (revision !== this.revision || !isLeaseLoss(error) || !(await this.recover(true))) throw error;
      if (revision === this.revision) await this.deliver(data);
    }
  }

  private async deliver(data: Uint8Array): Promise<void> {
    const grant = this.lease.currentGrant;
    if (this.lease.state !== "controlled" || !grant) {
      throw new HubError(-32603, "Terminal control is not held", null);
    }
    await this.input.input(
      { request_id: crypto.randomUUID(), grant, data: Array.from(data) },
      this.lease.origin,
    );
  }

  private async recover(force: boolean): Promise<boolean> {
    if (this.lease.state === "released") return false;
    if (!force && this.lease.state === "controlled" && this.lease.currentGrant) return true;
    try {
      await this.lease.acquire();
      return this.lease.state === "controlled" && this.lease.currentGrant !== null;
    } catch {
      return false;
    }
  }
}

function isLeaseLoss(error: unknown): boolean {
  if (!(error instanceof HubError)) return false;
  const data = error.data as { kind?: unknown; code?: unknown } | null;
  return data?.kind === "hub" && data.code === "invalid_lease";
}
