import { describe, expect, test } from "bun:test";
import { machineView } from "../server/machineView";
import { machineFor } from "../server/machineHandles";

const HUB = crypto.randomUUID();
process.env.YOLO_HUB_ID = HUB;
process.env.YOLO_HUB_SOCKET = "/tmp/yolo-web-machine-view-test.sock";
describe("machine view privacy", () => {
  test("replaces every address origin without leaking a raw Hub id", () => {
    const terminal = crypto.randomUUID();
    const agent = crypto.randomUUID();
    const view = machineView({
      hub: HUB,
      entry: true,
      label: "build-box",
      reachable: true,
      freshness: "live",
      epoch: "epoch-1",
      revision: 1,
      methods: ["create", "agent_start", "terminal", "attach", "list_providers"],
      providers: [
        { provider_id: "codex", display_name: "Codex", available: true },
        { provider_id: "claude_code", display_name: "Claude Code", available: false },
      ],
      terminals: [
        {
          address: { hub_id: HUB, terminal_id: terminal },
          runtime: { target: { address: { hub_id: HUB, terminal_id: terminal } } },
        },
      ],
      agents: [
        {
          cursor: { target: { address: { hub_id: HUB, agent_id: agent } } },
          terminal: { address: { hub_id: HUB, terminal_id: terminal } },
        },
      ],
    });
    expect(view.machine).toBe(machineFor(HUB));
    expect(view.label).toBe("build-box");
    expect(view.epoch).toBe("epoch-1");
    expect(view.revision).toBe(1);
    expect(view.providers).toEqual([
      { provider_id: "codex", display_name: "Codex", available: true },
      { provider_id: "claude_code", display_name: "Claude Code", available: false },
    ]);
    expect(view.capabilities).toEqual({
      known: true,
      create: true,
      agent_start: true,
      terminal_read: true,
      terminal_lifecycle: true,
      stage_attachment: false,
    });
    expect((view.terminals[0] as any).runtime.target.address.machine).toBe(machineFor(HUB));
    expect(JSON.stringify(view)).not.toContain(HUB);
    expect((view.agents[0] as any).cursor.target.address.machine).toBe(machineFor(HUB));
  });

  test("evicts finished rows and their agents while a blocked shell titled exit stays live", () => {
    const shell = (id: string, status: string) => ({
      address: { terminal_id: id }, presentation: { title: "exit" }, runtime: { status },
    });
    const rows = machineView({
      hub: HUB, entry: true, reachable: true, freshness: "live", epoch: "a1", revision: 3, methods: [],
      terminals: [shell("blocked", "output_blocked"), shell("gone", "exited"),
        shell("lost", "lost"), { ...shell("archived", "running"), archived: true }],
      agents: ["gone", "blocked"].map((id) => ({ terminal: { address: { terminal_id: id } } })),
    });
    expect(rows.terminals.map((t: any) => t.address.terminal_id)).toEqual(["blocked"]);
    expect(rows.agents.map((a: any) => a.terminal.address.terminal_id)).toEqual(["blocked"]);
  });

  test("uses a complete terminal listing to retire orphaned hook history from the live view", () => {
    const projected = { source: "provider_hook", lifecycle: { state: "unknown" }, freshness: "stale",
      reachability: "unreachable", terminal: { address: { terminal_id: "old" } } };
    const input = { hub: HUB, entry: false, reachable: true, freshness: "live" as const, epoch: "a",
      revision: 1, methods: [], terminals: [], agents: [projected] };
    expect(machineView({ ...input, terminalsComplete: true }).agents).toHaveLength(0);
    expect(machineView({ ...input, terminalsComplete: false }).agents).toHaveLength(1);
    expect(machineView({ ...input, terminalsComplete: true,
      agents: [{ ...projected, reachability: "reachable" }, { ...projected, source: "connector" }] }).agents).toHaveLength(2);
  });
});
