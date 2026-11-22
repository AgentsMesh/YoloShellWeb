import { HubError } from "./hubError.ts";

export type HubEndpoint = { socket: string; hubId: string };
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Outgoing = { id: number; bytes: Uint8Array; offset: number };
const CALL_TIMEOUT_MS = 10_000;

/** A timed-out call has an unknown server-side fate and must not be retried. */
export class HubTimeoutError extends Error {}

/** One JSON-RPC socket: framing, request correlation and failure fan-out. */
export class HubWire {
  private socket: import("bun").Socket | null = null;
  private pending = new Map<number, Pending>();
  private outgoing: Outgoing[] = [];
  private encoder = new TextEncoder();
  private sequence = 0;
  private buffer = "";
  private decoder = new TextDecoder();

  static async connect(endpoint: HubEndpoint): Promise<HubWire> {
    const wire = new HubWire();
    const lost = (error: Error): void => { wire.socket = null; wire.fail(error); };
    wire.socket = await Bun.connect({
      unix: endpoint.socket,
      socket: {
        data: (_socket, data) => wire.receive(data),
        drain: () => wire.flush(),
        close: () => lost(new Error("Hub connection closed")),
        error: (_socket, error) => lost(error),
      },
    });
    return wire;
  }

  get connected(): boolean { return this.socket !== null; }

  call(method: string, params: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    const id = ++this.sequence;
    if (!this.socket) return Promise.reject(new Error("Hub is not connected"));
    return new Promise((resolve, reject) => {
      const bytes = this.encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      const timer = setTimeout(() => this.timeout(id), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.outgoing.push({ id, bytes, offset: 0 });
      if (this.outgoing.length === 1) this.flush();
    });
  }

  private flush(): void {
    const socket = this.socket;
    if (!socket) return;
    try {
      while (this.outgoing.length) {
        const frame = this.outgoing[0];
        const written = socket.write(frame.bytes.subarray(frame.offset));
        if (written < 0) throw new Error("Hub socket closed during write");
        frame.offset += written;
        if (frame.offset < frame.bytes.length) return;
        this.outgoing.shift();
      }
    } catch (error) {
      this.abort(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private timeout(id: number): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.reject(new HubTimeoutError("Hub request timed out"));
    const index = this.outgoing.findIndex((frame) => frame.id === id);
    if (index < 0) return; // Already sent. Ignore its eventual reply.
    if (this.outgoing[index].offset === 0) {
      this.outgoing.splice(index, 1);
      return;
    }
    // A partial JSON line cannot be followed by another request on this stream.
    this.abort(new Error("Hub connection closed after a partial request timed out"));
  }

  private abort(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.fail(error);
    socket?.terminate();
  }

  close(): void {
    this.fail(new Error("Hub connection closed"));
    this.socket?.end();
    this.socket = null;
  }

  private receive(data: Uint8Array): void {
    this.buffer += this.decoder.decode(data, { stream: true });
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.frame(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private frame(line: string): void {
    if (!line.trim()) return;
    let message: {
      id?: number;
      result?: unknown;
      error?: { code?: number; message?: string; data?: unknown };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new HubError(
          message.error.code ?? -32603,
          message.error.message ?? "Hub error",
          message.error.data,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private fail(error: Error): void {
    this.outgoing = [];
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
