const MAX_PENDING_BYTES = 64 * 1024;

type Notice = (text: string) => void;
type PreparePaste = (signal: AbortSignal, progress: Notice) => Promise<string[]>;
export type PasteSource = string | PreparePaste;
type Paste = { source: string[] | PreparePaste; insert: (value: string) => void };

/** User gestures for one terminal view. xterm formats a paste only when its turn reaches the PTY. */
export class PendingInput {
  private items: (Uint8Array | Paste)[] = [];
  private bytes = 0;
  private upload?: AbortController;

  constructor(
    private readonly writable: () => boolean,
    private readonly write: (bytes: Uint8Array) => void,
    private readonly notice: Notice,
  ) {}

  get pending(): boolean { return this.items.length > 0; }

  input(data: Uint8Array): void {
    if (!this.pending && this.writable()) {
      this.write(data);
      return;
    }
    if (this.bytes + data.byteLength > MAX_PENDING_BYTES) {
      this.clear();
      this.notice("Queued input exceeded 64 KiB and was discarded. Take control and enter it again.");
      return;
    }
    this.items.push(Uint8Array.from(data));
    this.bytes += data.byteLength;
  }

  paste(source: PasteSource, insert: (value: string) => void): void {
    if (!this.pending) this.notice("");
    this.items.push({ source: typeof source === "string" ? [source] : source, insert });
  }

  clear(reason?: string): void {
    const pending = this.pending;
    this.items = [];
    this.bytes = 0;
    this.upload?.abort();
    this.upload = undefined;
    if (pending && reason) this.notice(`Queued input was discarded (${reason}). Paste or type it again.`);
  }

  flush(): void {
    if (this.upload || !this.writable()) return;
    try {
      while (this.items.length) {
        const next = this.items[0];
        if (next instanceof Uint8Array) {
          this.write(next);
          this.bytes -= next.byteLength;
        } else if (typeof next.source !== "function") {
          for (const text of next.source) next.insert(text);
          this.notice("");
        } else {
          this.upload = new AbortController();
          void this.prepare(next, next.source, this.upload.signal);
          return;
        }
        this.items.shift();
      }
    } catch (error) {
      this.failed(error);
    }
  }

  private failed(error: unknown): void {
    this.clear(error instanceof Error && error.message ? error.message : "the paste failed");
  }

  private async prepare(item: Paste, load: PreparePaste, signal: AbortSignal): Promise<void> {
    try {
      const value = await load(signal, (text) => { if (!signal.aborted) this.notice(text); });
      if (signal.aborted) return;
      item.source = value;
      this.upload = undefined;
      this.flush();
    } catch (error) {
      if (!signal.aborted) this.failed(error);
    }
  }
}
