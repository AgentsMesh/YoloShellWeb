import type { HubClient } from "./hub";
import { HubError } from "./hubError";
import { withChatWriter, type ChatWriterOps } from "./chatWriter";
import { createHash } from "node:crypto";
import { legacyUpdates } from "./chatLegacy";
import type { ChatBinding, ChatSession, ChatReadRequest, ChatReading, ChatContent, ChatPage } from "./chatTypes";

type Params = Record<string, any>;
type Transport = Pick<HubClient, "request">;
export type ChatCommand = { requestId?: string; schemaVersion?: number };
export type ChatAnswer = { kind: "choice"; choice: string } | { kind: "text"; text: string };

function sessionId(address: { hub_id: string; conversation_id: number[] }): string {
  return createHash("sha256").update(Buffer.from(address.hub_id.replaceAll("-", ""), "hex"))
    .update(Uint8Array.from(address.conversation_id)).digest("hex");
}

/** Provider-neutral Chat over an authenticated Hub connection. */
export class ManagedChat {
  private legacy = false;

  constructor(private readonly hub: Transport) {}

  private async call(operation: string, params: Params, destination: string, fallback: () => Promise<any>) {
    if (!this.legacy) {
      try {
        const reply = await this.hub.request("chat_v1", { ...params, operation }, destination) as Params;
        if (reply.version !== 1) throw new Error("Unsupported managed Chat response version");
        return reply;
      } catch (error) {
        if (!(error instanceof HubError) || error.code !== -32601) throw error;
        this.legacy = true;
      }
    }
    return fallback();
  }

  open(binding: ChatBinding, destination = binding.agent.address.hub_id): Promise<ChatSession> {
    return this.call("open", { binding }, destination, async () => {
      const { conversation } = await this.hub.request("resolve_conversation", { binding }, destination) as Params;
      return { version: 1, binding, address: conversation.address, sessionId: sessionId(conversation.address) };
    });
  }

  read(request: ChatReadRequest, destination = request.address.hub_id, waitMs = 0): Promise<{ version: number; reading: ChatReading }> {
    const params = waitMs ? { request, wait_ms: waitMs } : { request };
    return this.call("read", params, destination, async () => {
      const reply = await this.hub.request(waitMs ? "watch_conversation" : "read_conversation", params, destination) as Params;
      const reading = reply.reading;
      if (reading.status !== "page") return { version: 1, reading };
      const legacy = reading.page;
      const page: ChatPage = {
        sessionId: sessionId(request.address),
        history_generation: legacy.history_generation,
        revision: legacy.revision,
        availability: legacy.availability,
        partial: legacy.partial,
        next_cursor: legacy.next_cursor,
        entries: legacy.entries.map((entry: Params) => ({
          id: entry.id,
          role: entry.role,
          timestamp: entry.timestamp ?? null,
          updates: legacyUpdates(entry),
        })),
      };
      return { version: 1, reading: { status: "page", page } };
    });
  }

  state(target: Params, destination: string): Promise<{ version: number; agent: any }> {
    return this.call("state", { target }, destination, async () => {
      const reply = await this.hub.request("get_agent", { target }, destination) as Params;
      return { version: 1, agent: reply.agent };
    });
  }

  prompt(request: Params, destination: string): Promise<{ version: number; prompt: any }> {
    return this.call("prompt", { request }, destination, async () => {
      if (typeof request.prompt !== "string") throw new Error("This Hub needs an update for Chat attachments");
      return { version: 1, ...await this.hub.request("agent_prompt", { request }, destination) as Params };
    });
  }

  send(binding: ChatBinding, content: string | ChatContent[], options: ChatCommand = {}) {
    return this.prompt({
      schema_version: options.schemaVersion ?? 4, request_id: options.requestId ?? crypto.randomUUID(),
      reference: { reference: "execution", target: binding.agent }, prompt: content,
      wait: { wait: "none" }, take_control: true,
    }, binding.agent.address.hub_id);
  }

  answer(binding: ChatBinding, cursor: unknown, interactionId: string, response: ChatAnswer, options: ChatCommand = {}) {
    return this.act(binding, cursor, "respond", {
      operation: "respond", interaction: { target: binding.agent, id: interactionId }, response,
    }, options);
  }

  cancel(binding: ChatBinding, cursor: unknown, options: ChatCommand = {}) {
    return this.act(binding, cursor, "cancel", { operation: "interrupt" }, options);
  }

  private act(binding: ChatBinding, cursor: unknown, operation: "respond" | "cancel", action: object, options: ChatCommand) {
    const request = { schema_version: options.schemaVersion ?? 4, request_id: options.requestId ?? crypto.randomUUID(),
      target: binding.agent, expected_cursor: cursor, action };
    const wire: ChatWriterOps = {
      observeLease: (target, destination) => this.hub.request("observe_lease", { target }, destination),
      lease: (request, destination) => this.hub.request("lease", { request }, destination),
      release: (grant, destination) => this.hub.request("release", { grant }, destination),
    };
    return withChatWriter(wire, binding.runtime, (grant) => this.control(operation, request, grant, binding.agent.address.hub_id));
  }

  control(operation: "respond" | "cancel", request: Params, grant: unknown, destination: string) {
    return this.call(operation, { request, grant }, destination, async () => ({
      version: 1, ...await this.hub.request("agent_control", { request, grant }, destination) as Params,
    }));
  }
}
