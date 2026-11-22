import { withChatWriter } from "../../sdk/src/chatWriter";
import { ApiError } from "./errors";
import { interact, read } from "./hub";
import { AGENT_SCHEMA } from "./schema";
import { agentTarget, clientIdentity, message, record, uuid } from "./validate";
import { releaseControlForPrompt } from "./terminalRegistry";
import type { TerminalTarget } from "./target";

const CHOICE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const STALE_INTERRUPT = "The agent state changed. Check its current turn before interrupting.";

type Snapshot = {
  schema_version?: number;
  cursor?: { stream: string; sequence: number };
  terminal?: { address?: { terminal_id?: string }; runtime_epoch?: string };
  lifecycle?: { state?: string };
  reachability?: string;
  capabilities?: { respond_interaction?: { support?: string }; interrupt?: { support?: string } };
  interaction?: {
    reference?: { target?: unknown; id?: string };
    kind?: string;
    choices?: { id?: string }[];
  } | null;
};

type ControlResult = { receipt?: { outcome?: { state?: string; code?: string } } };

export type RespondOps = {
  state(target: ReturnType<typeof agentTarget>["agent"], destination: string): Promise<Snapshot>;
  observeLease(target: unknown, destination: string): Promise<unknown>;
  lease(request: unknown, destination: string): Promise<unknown>;
  control(request: Record<string, unknown>, grant: unknown, destination: string, operation: "respond" | "cancel"): Promise<ControlResult>;
  release(grant: unknown, destination: string): Promise<unknown>;
  releaseControl?(runtime: TerminalTarget, clientId: string): Promise<void>;
};

const live: RespondOps = {
  state: (target, destination) => read(destination, async (hub) => (await hub.chat.state(target, destination)).agent),
  observeLease: (target, destination) =>
    interact(destination, (hub) => hub.observeLease(target, destination)),
  lease: (request, destination) => interact(destination, (hub) => hub.lease(request, destination)),
  control: (request, grant, destination, operation) =>
    interact(destination, (hub) => hub.chat.control(operation, request, grant, destination)),
  release: (grant, destination) => interact(destination, (hub) => hub.release(grant, destination)),
  releaseControl: (runtime, client) => releaseControlForPrompt(runtime, client),
};

function responseAction(
  snapshot: Snapshot, agent: ReturnType<typeof agentTarget>["agent"], body: Record<string, unknown>,
) {
  const interaction = snapshot.interaction;
  const id = uuid(body.interaction_id);
  if (!interaction || interaction.reference?.id !== id) {
    throw new ApiError(409, "The interaction is no longer current");
  }
  let response;
  if (interaction.kind === "text" && body.answer !== undefined) {
    response = { kind: "text", text: message(body.answer) };
  } else {
    const choice = body.choice;
    if (typeof choice !== "string" || !CHOICE.test(choice) ||
        !interaction.choices?.some((item) => item.id === choice)) {
      throw new ApiError(400, "Choice is not available");
    }
    response = { kind: "choice", choice };
  }
  return { operation: "respond", interaction: { target: agent, id }, response };
}

function requireObservedTurn(value: unknown, current: NonNullable<Snapshot["cursor"]>): void {
  if (value == null) throw new ApiError(409, STALE_INTERRUPT);
  const position = record(value);
  const stream = uuid(position.stream);
  const sequence = position.sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new ApiError(400, "Invalid observation sequence");
  }
  if (stream !== current.stream || sequence !== current.sequence) {
    throw new ApiError(409, STALE_INTERRUPT);
  }
}

/** Read the owning agent's current cursor before an action takes its writer lease. */
export async function respond(
  body: Record<string, unknown>,
  ops: RespondOps = live,
  operation: "respond" | "cancel" = "respond",
): Promise<unknown> {
  const { agent, runtime } = agentTarget(body);
  const destination = agent.address.hub_id;
  const snapshot = await ops.state(agent, destination);
  if (!snapshot?.cursor || snapshot.lifecycle?.state !== "running") {
    throw new ApiError(409, "The agent is no longer current");
  }
  if (operation === "cancel") requireObservedTurn(body.expected_cursor, snapshot.cursor);
  const capability = operation === "cancel" ? "interrupt" : "respond_interaction";
  if (snapshot.capabilities?.[capability]?.support !== "available") {
    throw new ApiError(409, "This action is unavailable for the agent");
  }
  const action = operation === "cancel" ? { operation: "interrupt" } : responseAction(snapshot, agent, body);
  if (
    snapshot.terminal?.address?.terminal_id !== runtime.address.terminal_id ||
    snapshot.terminal?.runtime_epoch !== runtime.runtime_epoch
  ) {
    throw new ApiError(409, "The interaction terminal changed");
  }
  const client = clientIdentity(body.client_id);
  if (client !== null) await ops.releaseControl?.(runtime, client);
  return withChatWriter(ops, runtime, async (grant) => {
    const request = {
      schema_version: snapshot.schema_version ?? AGENT_SCHEMA,
      request_id: crypto.randomUUID(),
      target: agent,
      expected_cursor: snapshot.cursor,
      action,
    };
    const result = await ops.control(request, grant, destination, operation);
    const outcome = result.receipt?.outcome;
    if (operation === "cancel" && outcome?.state === "failed" && outcome.code === "preconditions_changed") {
      throw new ApiError(409, STALE_INTERRUPT);
    }
    return result;
  });
}
