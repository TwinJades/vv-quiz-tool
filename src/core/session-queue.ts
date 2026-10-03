export interface QueueSnapshot {
  concurrency: number;
  running: number[];
  queued: number[];
}

interface QueuedRun {
  key: number;
  run: () => Promise<void>;
  settled: Promise<void>;
  resolveSettled: () => void;
}

/** Slots remain occupied until a cancelled/paused runner actually settles. */
export class SessionQueue {
  #limit = 3;
  #waiting: QueuedRun[] = [];
  #running = new Map<number, QueuedRun>();

  constructor(private readonly onError: (key: number, error: unknown) => void = () => {}) {}

  snapshot(): QueueSnapshot {
    return { concurrency: this.#limit, running: [...this.#running.keys()], queued: this.#waiting.map(item => item.key) };
  }

  has(key: number): boolean {
    return this.#running.has(key) || this.#waiting.some(item => item.key === key);
  }

  setConcurrency(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Concurrency must be an integer from 1 to 10.");
    this.#limit = limit;
    this.#pump();
  }

  enqueue(key: number, run: () => Promise<void>): void {
    if (this.has(key)) throw new Error("This tab already has a running or queued task.");
    let resolveSettled!: () => void;
    const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
    this.#waiting.push({ key, run, settled, resolveSettled });
    this.#pump();
  }

  cancelQueued(key: number): boolean {
    const index = this.#waiting.findIndex(item => item.key === key);
    if (index < 0) return false;
    const [item] = this.#waiting.splice(index, 1);
    item!.resolveSettled();
    return true;
  }

  async settled(key: number): Promise<void> {
    const item = this.#running.get(key) ?? this.#waiting.find(item => item.key === key);
    if (item) await item.settled;
  }

  #pump(): void {
    while (this.#running.size < this.#limit && this.#waiting.length > 0) {
      const item = this.#waiting.shift()!;
      this.#running.set(item.key, item);
      void Promise.resolve().then(item.run).catch(error => this.onError(item.key, error)).finally(() => {
        this.#running.delete(item.key);
        item.resolveSettled();
        this.#pump();
      });
    }
  }
}
