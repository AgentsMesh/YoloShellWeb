import { describe, expect, test } from "bun:test";
import { HubError } from "../../sdk/src/hubError";
import { InputQueue } from "../../sdk/src/inputQueue";

function leaseLoss() {
  return new HubError(-32000, "invalid writer lease", {
    kind: "hub",
    code: "invalid_lease",
  });
}

class FakeLease {
  state: "observing" | "controlled" | "released" = "controlled";
  currentGrant: object | null = { generation: 1 };
  acquisitions = 0;

  async acquire() {
    this.acquisitions += 1;
    this.state = "controlled";
    this.currentGrant = { generation: 2 };
  }
}

describe("terminal input queue", () => {
  test("retries a lease-rejected chunk once after reacquiring", async () => {
    const lease = new FakeLease();
    const sent: number[][] = [];
    let attempts = 0;
    const input = {
      async input(request: { data: number[] }) {
        attempts += 1;
        if (attempts === 1) throw leaseLoss();
        sent.push(request.data);
      },
    };
    const errors: Error[] = [];
    const queue = new InputQueue(input as any, {} as any, lease as any, (error) => errors.push(error));
    queue.enqueue(Uint8Array.from([1, 2, 3]));
    await Bun.sleep(1);
    expect(lease.acquisitions).toBe(1);
    expect(sent).toEqual([[1, 2, 3]]);
    expect(errors).toEqual([]);
  });

  test("coalesces input that queued behind one delivery into one request", async () => {
    const lease = new FakeLease();
    const calls: number[][] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const input = {
      async input(request: { data: number[] }) {
        calls.push(request.data);
        if (calls.length === 1) await first;
      },
    };
    const queue = new InputQueue(input as any, {} as any, lease as any, () => {});
    queue.enqueue(Uint8Array.from([1]));
    queue.enqueue(Uint8Array.from([2]));
    queue.enqueue(Uint8Array.from([3]));
    release();
    await Bun.sleep(1);
    expect(calls).toEqual([[1], [2, 3]]);
  });

  test("does not reacquire after an explicit release", async () => {
    const lease = new FakeLease();
    lease.state = "released";
    lease.currentGrant = null;
    const errors: Error[] = [];
    const queue = new InputQueue(
      { input: async () => {} } as any,
      {} as any,
      lease as any,
      (error) => errors.push(error),
    );
    queue.enqueue(Uint8Array.from([6]));
    await Bun.sleep(1);
    expect(lease.acquisitions).toBe(0);
    expect(errors).toHaveLength(1);
  });

  test("reports and drops the batch when control cannot be recovered", async () => {
    const lease = new FakeLease();
    lease.state = "observing";
    lease.currentGrant = null;
    lease.acquire = async () => {
      throw new Error("held by another client");
    };
    const errors: Error[] = [];
    const queue = new InputQueue(
      { input: async () => {} } as any,
      {} as any,
      lease as any,
      (error) => errors.push(error),
    );
    queue.enqueue(Uint8Array.from([4, 5]));
    await Bun.sleep(1);
    expect(errors).toHaveLength(1);
  });
});

test("65,537 bytes are split and coalesced into eight acknowledged 8 KiB writes and one byte", async () => {
  const data = Uint8Array.from({ length: 65_537 }, (_, i) => i % 251);
  const writes: number[][] = [];
  const ready = Array.from({ length: 9 }, () => Promise.withResolvers<void>());
  const ack = ready.map(() => Promise.withResolvers<void>());
  const input = {
    input(request: { data: number[] }) {
      const index = writes.length;
      writes.push(request.data);
      ready[index].resolve();
      return ack[index].promise;
    },
  };
  const queue = new InputQueue(input as any, {} as any, new FakeLease() as any, () => {});
  queue.enqueue(data.subarray(0, 32_768));
  for (let offset = 32_768; offset < data.length; offset += 1024) queue.enqueue(data.subarray(offset, offset + 1024));
  for (let index = 0; index < ack.length; index++) {
    await ready[index].promise;
    expect(writes).toHaveLength(index + 1);
    expect(writes[index]).toHaveLength(index === 8 ? 1 : 8192);
    ack[index].resolve();
  }
  expect(Uint8Array.from(writes.flat())).toEqual(data);
});

test("an uncertain second write drops the rest of a large paste and its Enter", async () => {
  const failure = new HubError(-32000, "operation outcome is unknown", { kind: "hub", code: "outcome_unknown" });
  const reported = Promise.withResolvers<Error>();
  const writes: number[] = [];
  const lease = new FakeLease();
  const input = { async input(request: { data: number[] }) {
    writes.push(request.data.length);
    if (writes.length === 2) throw failure;
  } };
  const queue = new InputQueue(input as any, {} as any, lease as any, reported.resolve);
  queue.enqueue(new Uint8Array(65_537));
  queue.enqueue(Uint8Array.of(13));
  expect(await reported.promise).toBe(failure);
  expect(writes).toEqual([8192, 8192]);
  expect(lease.acquisitions).toBe(0);
});

test("a canceled acquisition cannot later send its input under the new writer", async () => {
  const lease = new FakeLease();
  lease.state = "observing";
  lease.currentGrant = null;
  const acquiring = Promise.withResolvers<void>();
  const grant = Promise.withResolvers<void>();
  lease.acquire = async () => {
    acquiring.resolve();
    await grant.promise;
    lease.state = "controlled";
    lease.currentGrant = { generation: 2 };
  };
  const sent = Promise.withResolvers<number[]>();
  const input = { input: (request: { data: number[] }) => sent.resolve(request.data) };
  const queue = new InputQueue(input as any, {} as any, lease as any, () => {});
  queue.enqueue(Uint8Array.of(12));
  await acquiring.promise;
  expect(queue.discardPending()).toBe(true);
  queue.enqueue(Uint8Array.of(34));
  grant.resolve();
  expect(await sent.promise).toEqual([34]);
});
