import { expect, test } from "bun:test";
import { interruptPayload } from "../browser/payload";
import { respond } from "../server/interaction";
import { fixture, harness } from "./respondFixture";

function observed() {
  const { snapshot, body } = fixture();
  const { stream, sequence } = snapshot.cursor;
  const check = harness({
    ...snapshot, capabilities: { interrupt: { support: "available" } },
  });
  return {
    ...check,
    body: { ...body, client_id: "first-tab", expected_cursor: { stream, sequence } },
    snapshot,
  };
}

test("the browser sends the clicked observation without a raw origin address", () => {
  const { body, snapshot } = observed();
  const payload = interruptPayload({
    cursor: { target: { address: { machine: body.machine, agent_id: body.agent_id },
      execution_id: body.execution_id }, stream: snapshot.cursor.stream, sequence: snapshot.cursor.sequence },
    terminal: { address: { machine: body.machine, terminal_id: body.terminal_id }, runtime_epoch: body.runtime_epoch },
  });
  expect(payload.expected_cursor).toEqual(body.expected_cursor);
  expect(JSON.stringify(payload)).not.toContain(snapshot.terminal.address.hub_id);
});

test("a later observation or reset stream rejects the interrupt before any change in writer ownership", async () => {
  const { body, requests, ops } = observed();
  const { stream, sequence } = body.expected_cursor;
  for (const expected_cursor of [undefined, { stream, sequence: sequence - 1 },
    { stream: crypto.randomUUID(), sequence }]) {
    await expect(respond({ ...body, expected_cursor }, ops, "cancel")).rejects.toMatchObject({ status: 409 });
    expect(requests().controlReleased).toBeNull();
    expect(requests().leaseRequest).toBeNull();
    expect(requests().controlRequest).toBeNull();
  }
});

test("an origin rejecting a late interrupt returns 409 and releases the writer", async () => {
  const { body, ops, requests, grant, snapshot } = observed();
  let sent = 0;
  ops.control = async (request) => {
    expect(request.expected_cursor).toEqual(snapshot.cursor);
    sent++;
    return { receipt: { outcome: { state: "failed", code: "preconditions_changed" } } };
  };
  await expect(respond(body, ops, "cancel")).rejects.toMatchObject({ status: 409 });
  expect(sent).toBe(1);
  expect(requests().released).toBe(grant);
});
