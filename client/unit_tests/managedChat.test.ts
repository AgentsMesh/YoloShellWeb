import { expect, test } from "bun:test";
import { ManagedChat } from "../../sdk/src/chat";
import { HubError } from "../../sdk/src/hubError";
import { legacyUpdates } from "../../sdk/src/chatLegacy";
import { promptContent } from "../server/promptContent";

test("negotiates chat_v1 and preserves the target and pagination request", async () => {
  const calls: unknown[] = [];
  const chat = new ManagedChat({ async request(method, params, destination) {
    calls.push([method, params, destination]);
    return { version: 1, reading: { status: "unchanged" } };
  } });
  const request = { address: {}, binding: {}, cursor: { before_offset: 7 } };
  expect((await chat.read(request, "peer", 900)).reading.status).toBe("unchanged");
  expect(calls).toEqual([["chat_v1", { operation: "read", request, wait_ms: 900 }, "peer"]]);
});

test("an old Hub produces the same typed tool/text updates; a failed mutation is never replayed", async () => {
  const calls: string[] = [];
  const chat = new ManagedChat({ async request(method) {
    calls.push(method);
    if (method === "chat_v1") throw new HubError(-32601, "Unknown method", null);
    return { reading: { status: "page", page: { entries: [
      { role: "tool", parts: [{ kind: "tool_result", call_id: "old", output: "done", is_error: false }] },
    ] } } };
  } });
  const request = { address: { hub_id: crypto.randomUUID(), conversation_id: Array(32).fill(9) } };
  const { reading } = await chat.read(request, "peer");
  if (reading.status !== "page") throw Error("Missing page");
  expect(reading.page.entries[0].updates).toEqual([{ sessionUpdate: "tool_call_update",
    toolCallId: "old", status: "completed", content: [{ type: "content", content: { type: "text", text: "done" } }] }]);
  expect(calls).toEqual(["chat_v1", "read_conversation"]);
  expect(legacyUpdates({ role: "user", parts: [{ kind: "text", text: "hi" }] })[0].sessionUpdate).toBe("user_message_chunk");
  let attempts = 0;
  const broken = new ManagedChat({ async request() { attempts++; throw Error("connection lost"); } });
  await expect(broken.prompt({ prompt: "once" }, "peer")).rejects.toThrow("connection lost");
  expect(attempts).toBe(1);
});

test("a legacy conversation read exposes exactly the Chat v1 page and entry fields", async () => {
  const hub_id = "01234567-89ab-4cde-8fed-cba987654321";
  const address = { hub_id, conversation_id: Array(32).fill(9) };
  const binding = {
    agent: { address: { hub_id, agent_id: crypto.randomUUID() }, execution_id: crypto.randomUUID() },
    runtime: { address: { hub_id, terminal_id: crypto.randomUUID() }, runtime_epoch: crypto.randomUUID() },
  };
  const history_generation = Array(32).fill(7);
  const metadata = {
    history_generation, revision: Array(32).fill(8), availability: "available",
    partial: ["page_byte_limit"], next_cursor: { address, history_generation, before_offset: 128 },
  };
  const entry = { id: Array(32).fill(1), role: "assistant", timestamp: "2026-11-22T12:00:00Z" };
  const chat = new ManagedChat({ async request(method) {
    if (method === "chat_v1") throw new HubError(-32601, "Unknown method", null);
    expect(method).toBe("read_conversation");
    return { reading: { status: "page", page: {
      ...metadata,
      conversation: { address, binding, provider: "codex", provider_session_id: "native-session", source: "native_transcript" },
      entries: [{ ...entry, native_id: "native-entry", parent_id: "parent", parts: [{ kind: "text", text: "hello" }] }],
    } } };
  } });
  const reply = await chat.read({
    address, binding, cursor: null, limits: { entries: 64, bytes: 262144 }, since_revision: null, since_generation: null,
  });
  expect(reply).toStrictEqual({ version: 1, reading: { status: "page", page: {
    ...metadata,
    sessionId: "bfa3a915b544b956367cef59339baf32b5969a5a5c1a529cd8ecd6128a417206",
    entries: [{ ...entry, updates: [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } }] }],
  } } });
});

test("a file-only prompt accepts local resource links and rejects remote URLs", () => {
  const file = { type: "resource_link", name: "é.png", uri: "file:///tmp/%C3%A9.png", mimeType: "image/png" };
  expect(promptContent([file])).toEqual([file]);
  expect(() => promptContent([{ ...file, uri: "https://example.org/img" }])).toThrow();
});

test("one Chat client acquires and releases the origin writer around a permission answer", async () => {
  const methods: string[] = [];
  const requests: any[] = [];
  const chat = new ManagedChat({ async request(method, params, destination) {
    methods.push(method); requests.push(params);
    expect(destination).toBe("peer");
    if (method === "observe_lease") return { lease: { generation: 5 } };
    if (method === "lease") return { grant: { lease_id: "lease" } };
    if (method === "chat_v1") return { version: 1, receipt: { outcome: { state: "delivered" } } };
    return {};
  } });
  const binding = {
    agent: { address: { hub_id: "peer", agent_id: "agent" }, execution_id: "execution" },
    runtime: { address: { hub_id: "peer", terminal_id: "terminal" }, runtime_epoch: "epoch" },
  };
  await chat.answer(binding, { sequence: 72 }, "ask", { kind: "text", text: "yes" });
  expect(methods).toEqual(["observe_lease", "lease", "chat_v1", "release"]);
  expect(requests[1].request.mode).toEqual({ mode: "take_control", observed_generation: 5 });
  expect(requests[2].request.action.response.text).toBe("yes");
  expect(requests[3].grant.lease_id).toBe("lease");
});
