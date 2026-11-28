import { expect, test } from "bun:test";
import { CatalogueWatch } from "../server/catalogueWatch";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

test("one entry wait reports just the changed origins and a restart refreshes every machine", async () => {
  const entry = crypto.randomUUID(), peer = crypto.randomUUID(), other = crypto.randomUUID();
  const epoch = crypto.randomUUID(), nextEpoch = crypto.randomUUID();
  const c1 = crypto.randomUUID(), c2 = crypto.randomUUID(), c3 = crypto.randomUUID();
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const refreshes: (string[] | null)[] = [];
  const calls: (string | null)[] = [];
  let resolveWait!: (value: unknown) => void, cancel!: () => void;
  let closed = 0;
  const watch = new CatalogueWatch(changed => refreshes.push(changed ? [...changed] : null), () => {},
    async () => ({
      hubId: entry, extensions: async () => ["watch_catalogues"],
      request: async (method, params, destination) => {
        expect(method).toBe("watch_catalogues");
        expect(destination).toBe(entry);
        const after = params.after as string | null;
        calls.push(after);
        if (after === null) return { epoch, cursor: c1, origins: { [peer]: first, [other]: first } };
        return new Promise((resolve, reject) => {
          resolveWait = resolve;
          cancel = () => reject(new Error("closed"));
        });
      },
      close: () => { closed++; cancel?.(); },
    }));
  const running = watch.run();
  await tick();
  expect(refreshes).toEqual([null]);
  expect(calls).toEqual([null, c1]);
  resolveWait({ epoch, cursor: c1, origins: null });
  await tick();
  expect(refreshes).toEqual([null]);
  resolveWait({ epoch, cursor: c2, origins: { [peer]: second, [other]: first } });
  await tick();
  expect(refreshes).toEqual([null, [peer]]);
  resolveWait({ epoch: nextEpoch, cursor: c3, origins: {} });
  await tick();
  expect(refreshes).toEqual([null, [peer], null]);
  watch.stop();
  await running;
  expect(closed).toBe(1);
});

test("an older entry frees its probe connection and keeps timed observations", async () => {
  let closed = 0, watches = 0;
  const modes: boolean[] = [];
  const watch = new CatalogueWatch(() => {}, watching => modes.push(watching), async () => ({
    hubId: crypto.randomUUID(), extensions: async () => [],
    request: async () => { watches++; return {}; }, close: () => { closed++; },
  }));
  const running = watch.run();
  await new Promise(resolve => setTimeout(resolve, 2600));
  watch.stop();
  await running;
  expect(modes).toEqual([false]);
  expect({ closed, watches }).toEqual({ closed: 1, watches: 0 });
});
