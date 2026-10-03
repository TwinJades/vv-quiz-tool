/** Local monotonic estimate between actual website timer observations. */
export class SessionTimer {
  #deadline: number | null = null;
  constructor(private readonly now: () => number = () => performance.now()) {}
  observe(seconds: number | null | undefined): void {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return;
    const deadline = this.now() + seconds * 1000;
    this.#deadline = this.#deadline === null ? deadline : Math.min(this.#deadline, deadline);
  }
  remaining(): number | null {
    return this.#deadline === null ? null : Math.max(0, (this.#deadline - this.now()) / 1000);
  }
  closing(): boolean { const remaining = this.remaining(); return remaining !== null && remaining <= 60; }
  solveMilliseconds(reserveSeconds = 5): number | null {
    const remaining = this.remaining();
    return remaining === null ? null : Math.min(2147483647, Math.max(0, Math.floor((remaining - reserveSeconds) * 1000)));
  }
}
