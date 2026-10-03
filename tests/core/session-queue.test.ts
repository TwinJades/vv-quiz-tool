import { describe, expect, it } from "vitest";
import { SessionQueue } from "../../src/core/session-queue";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function tick() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe("SessionQueue", () => {
  it("runs three tasks and starts the fourth only after a slot settles", async () => {
    const queue = new SessionQueue();
    const gates = [gate(), gate(), gate(), gate()];
    const entered: number[] = [];
    gates.forEach((item, index) => queue.enqueue(index, async () => { entered.push(index); await item.promise; }));
    await tick();
    expect(entered).toEqual([0, 1, 2]);
    expect(queue.snapshot()).toEqual({ concurrency: 3, running: [0, 1, 2], queued: [3] });
    gates[1]!.release();
    await queue.settled(1);
    await tick();
    expect(entered).toEqual([0, 1, 2, 3]);
    gates.forEach(item => item.release());
    await Promise.all([0, 2, 3].map(key => queue.settled(key)));
  });

  it("cancels a queued tab without executing it", async () => {
    const queue = new SessionQueue(); queue.setConcurrency(1);
    const first = gate(); let called = false;
    queue.enqueue(1, () => first.promise);
    queue.enqueue(2, async () => { called = true; });
    expect(queue.cancelQueued(2)).toBe(true);
    first.release(); await queue.settled(1); await tick();
    expect(called).toBe(false);
    expect(queue.snapshot().queued).toEqual([]);
  });

  it("cannot release an active slot while cancellation is still settling", async () => {
    const queue = new SessionQueue(); queue.setConcurrency(1);
    const first = gate(); let secondCalled = false;
    queue.enqueue(1, () => first.promise);
    queue.enqueue(2, async () => { secondCalled = true; });
    expect(queue.cancelQueued(1)).toBe(false);
    await tick(); expect(secondCalled).toBe(false);
    first.release(); await queue.settled(1); await tick();
    expect(secondCalled).toBe(true);
  });

  it("lowers the limit without cancelling active tasks or starting additional ones", async () => {
    const queue = new SessionQueue(); const gates = [gate(), gate(), gate()];
    gates.forEach((item, key) => queue.enqueue(key, () => item.promise));
    queue.setConcurrency(1); queue.enqueue(4, async () => {});
    gates[0]!.release(); gates[1]!.release();
    await queue.settled(0); await queue.settled(1);
    expect(queue.snapshot()).toEqual({ concurrency: 1, running: [2], queued: [4] });
    gates[2]!.release(); await queue.settled(2); await queue.settled(4);
  });

  it("increasing the limit immediately drains queued tasks", async () => {
    const queue = new SessionQueue(); queue.setConcurrency(1);
    const first = gate(); const second = gate();
    queue.enqueue(1, () => first.promise); queue.enqueue(2, () => second.promise);
    queue.setConcurrency(2);
    expect(queue.snapshot().running).toEqual([1, 2]);
    first.release(); second.release(); await queue.settled(1); await queue.settled(2);
  });

  it("contains runner failure and drains the queue", async () => {
    const errors: number[] = []; const queue = new SessionQueue(key => { errors.push(key); }); queue.setConcurrency(1);
    queue.enqueue(1, async () => { throw new Error("Provider offline"); });
    let second = false; queue.enqueue(2, async () => { second = true; });
    await queue.settled(1); await queue.settled(2);
    expect(errors).toEqual([1]); expect(second).toBe(true);
  });

  it("rejects duplicate running/queued tabs and invalid concurrency", async () => {
    const queue = new SessionQueue(); const first = gate(); queue.enqueue(1, () => first.promise);
    expect(() => queue.enqueue(1, async () => {})).toThrow("already");
    for (const value of [0, 11, 1.5, NaN]) expect(() => queue.setConcurrency(value)).toThrow("integer");
    first.release(); await queue.settled(1);
  });
});
