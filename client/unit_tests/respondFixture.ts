import { machineFor } from "../server/machineHandles";
import type { RespondOps } from "../server/interaction";

export function fixture() {
  const hub = crypto.randomUUID();
  process.env.YOLO_HUB_ID = hub;
  process.env.YOLO_HUB_SOCKET = "/tmp/yolo-web-test.sock";
  const agentId = crypto.randomUUID();
  const executionId = crypto.randomUUID();
  const terminalId = crypto.randomUUID();
  const runtimeEpoch = crypto.randomUUID();
  const interactionId = crypto.randomUUID();
  const target = {
    address: { hub_id: hub, agent_id: agentId },
    execution_id: executionId,
  };
  const cursor = { target, stream: crypto.randomUUID(), sequence: 7 };
  const snapshot = {
    schema_version: 4,
    cursor,
    terminal: {
      address: { hub_id: hub, terminal_id: terminalId },
      runtime_epoch: runtimeEpoch,
    },
    lifecycle: { state: "running" },
    reachability: "reachable",
    capabilities: { respond_interaction: { support: "available" } },
    interaction: {
      reference: { target, id: interactionId },
      kind: "approval",
      choices: [
        { id: "allow", label: "Allow" },
        { id: "deny", label: "Deny" },
      ],
      prompt: "Bash: cargo test",
    },
  };
  const body = {
    machine: machineFor(hub),
    agent_id: agentId,
    execution_id: executionId,
    terminal_id: terminalId,
    runtime_epoch: runtimeEpoch,
    interaction_id: interactionId,
    choice: "allow",
  };
  return { snapshot, body, interactionId, target, hub };
}

export function harness(snapshot: unknown) {
  let leaseRequest: any = null;
  let controlRequest: any = null;
  let controlGrant: unknown = null;
  let released: unknown = null;
  let controlReleased: { runtime: any; client: string } | null = null;
  const destinations: string[] = [];
  const grant = { marker: crypto.randomUUID() };
  const ops: RespondOps = {
    state: async () => snapshot as Awaited<ReturnType<RespondOps["state"]>>,
    observeLease: async (_target, destination) => {
      destinations.push(destination);
      return { lease: { generation: 8 } };
    },
    lease: async (request, destination) => {
      leaseRequest = request;
      destinations.push(destination);
      return { grant };
    },
    control: async (request, used, destination) => {
      controlRequest = request;
      controlGrant = used;
      destinations.push(destination);
      return { receipt: { outcome: { state: "delivered" } } };
    },
    release: async (used, destination) => {
      released = used;
      destinations.push(destination);
      return {};
    },
    releaseControl: async (runtime, client) => {
      controlReleased = { runtime, client };
    },
  };
  return {
    ops,
    grant,
    destinations,
    requests: () => ({
      leaseRequest,
      controlRequest,
      controlGrant,
      released,
      controlReleased,
    }),
  };
}
