import { describe, expect, test } from "bun:test";
import { collectPages, observePages } from "../../sdk/src/pages";

describe("paged catalogue reads", () => {
  test("walks next cursors unchanged and keeps every page", async () => {
    const seen: unknown[] = [];
    const pages: Record<string, unknown>[] = [
      { agents: [{ id: 1 }], next: { address: { agent_id: "a" }, execution_id: "e" } },
      { agents: [{ id: 2 }], next: "second" },
      { agents: [{ id: 3 }], next: null },
    ];
    const rows = await collectPages("agents", async (after) => {
      seen.push(after);
      return pages[seen.length - 1];
    });
    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(seen).toEqual([
      null,
      { address: { agent_id: "a" }, execution_id: "e" },
      "second",
    ]);
  });

  test("ends on a repeated cursor instead of looping", async () => {
    let calls = 0;
    const cursor = { hub_id: "h" };
    const rows = await collectPages("hubs", async () => {
      calls += 1;
      return { hubs: calls === 1 ? [{ hub_id: "h", reachable: true }] : [], next: cursor };
    });
    expect(rows).toEqual([{ hub_id: "h", reachable: true }]);
    expect(calls).toBe(2);
  });

  test("ignores a malformed page and bounds a walk with no end", async () => {
    let calls = 0;
    const malformed = await collectPages("terminals", async () => {
      calls += 1;
      return { terminals: "not-a-list", next: null };
    });
    expect(malformed).toEqual([]);
    expect(calls).toBe(1);

    calls = 0;
    await collectPages("terminals", async () => {
      calls += 1;
      return { terminals: [], next: calls };
    });
    expect(calls).toBe(64);
  });

  test("only valid pages ending with a null cursor make a complete observation", async () => {
    expect(await observePages("agents", async () => ({ agents: [], next: null })))
      .toEqual({ rows: [], complete: true });
    expect(await observePages("agents", async () => ({ agents: [1] })))
      .toEqual({ rows: [1], complete: false });
    expect(await observePages("agents", async (after) =>
      after === null ? { next: 1 } : { agents: [2], next: null }))
      .toEqual({ rows: [2], complete: false });
    expect(await observePages("agents", async () => ({ agents: [], next: 1 })))
      .toEqual({ rows: [], complete: false });
    const cycle = [1, 2, 1, null];
    expect(await observePages("agents", async () => ({ agents: [], next: cycle.shift() })))
      .toEqual({ rows: [], complete: false });
    let calls = 0;
    const capped = await observePages("agents", async () => ({ agents: [++calls], next: calls }));
    expect(capped.complete).toBe(false);
    expect(capped.rows).toHaveLength(64);
  });
});
