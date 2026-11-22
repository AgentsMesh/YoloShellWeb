import { describe, expect, test } from "bun:test";
import { machineFor } from "../server/machineHandles";
import { respond } from "../server/interaction";
import { fixture, harness } from "./respondFixture";

describe("web interaction response", () => {
  test("releases the same tab's terminal control before taking the answer lease", async () => {
    const { snapshot, body } = fixture();
    const harnessed = harness(snapshot);
    body.client_id = "tab-r";
    await respond(body, harnessed.ops);
    const { controlReleased } = harnessed.requests();
    expect(controlReleased?.client).toBe("tab-r");
    expect(controlReleased?.runtime.address.terminal_id).toBe(body.terminal_id);
    expect(controlReleased?.runtime.runtime_epoch).toBe(body.runtime_epoch);
  });

  test("re-reads the snapshot and sends an exact respond with a taken lease", async () => {
    const { snapshot, body, interactionId, target, hub } = fixture();
    const harnessed = harness(snapshot);
    const result = await respond(body, harnessed.ops);
    expect(result).toEqual({ receipt: { outcome: { state: "delivered" } } });
    const { leaseRequest, controlRequest, controlGrant, released } = harnessed.requests();
    expect(leaseRequest.mode).toEqual({ mode: "take_control", observed_generation: 8 });
    expect(leaseRequest.target).toEqual(snapshot.terminal);
    expect(controlRequest.schema_version).toBe(4);
    expect(controlRequest.target).toEqual(target);
    expect(controlRequest.expected_cursor).toEqual(snapshot.cursor);
    expect(controlRequest.action).toEqual({
      operation: "respond",
      interaction: { target, id: interactionId },
      response: { kind: "choice", choice: "allow" },
    });
    expect(controlGrant).toBe(harnessed.grant);
    expect(released).toBe(harnessed.grant);
    expect(harnessed.destinations).toEqual([hub, hub, hub, hub]);
  });

  test("routes every answer RPC to the agent's owning Hub", async () => {
    const { snapshot, body, target } = fixture();
    const peer = crypto.randomUUID();
    body.machine = machineFor(peer);
    target.address.hub_id = peer;
    snapshot.terminal.address.hub_id = peer;
    const harnessed = harness(snapshot);
    await respond(body, harnessed.ops);
    expect(harnessed.destinations).toEqual([peer, peer, peer, peer]);
    expect(harnessed.requests().controlRequest.target.address.hub_id).toBe(peer);
  });

  test("rejects an unavailable capability, stale interaction or unknown choice", async () => {
    for (const mutate of [
      (snapshot: any) => {
        snapshot.capabilities.respond_interaction = { support: "unsupported" };
      },
      (snapshot: any) => {
        snapshot.interaction.reference.id = crypto.randomUUID();
      },
      (snapshot: any) => {
        snapshot.interaction.choices = [{ id: "deny", label: "Deny" }];
      },
      (snapshot: any) => {
        snapshot.lifecycle.state = "exited";
      },
    ]) {
      const { snapshot, body } = fixture();
      mutate(snapshot);
      const harnessed = harness(snapshot);
      await expect(respond(body, harnessed.ops)).rejects.toThrow();
      expect(harnessed.requests().leaseRequest).toBeNull();
    }
  });

  test("acquires a free lease without an observed generation", async () => {
    const { snapshot, body } = fixture();
    const harnessed = harness(snapshot);
    harnessed.ops.observeLease = async () => ({ lease: null });
    await respond(body, harnessed.ops);
    expect(harnessed.requests().leaseRequest.mode).toEqual({ mode: "acquire" });
  });

  test("supports text answers and fences interrupt through the same live cursor", async () => {
    const { snapshot, body } = fixture();
    snapshot.interaction.kind = "text";
    const check = harness({ ...snapshot, capabilities: {
      ...snapshot.capabilities, interrupt: { support: "available" },
    } });
    await respond({ ...body, choice: undefined, answer: "yes please" }, check.ops);
    expect(check.requests().controlRequest.action.response).toEqual({ kind: "text", text: "yes please" });
    await respond({ ...body, expected_cursor: snapshot.cursor }, check.ops, "cancel");
    expect(check.requests().controlRequest.action).toEqual({ operation: "interrupt" });
    expect(check.requests().controlRequest.expected_cursor).toEqual(snapshot.cursor);
  });
});
