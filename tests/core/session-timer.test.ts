import { describe, expect, it } from "vitest";
import { SessionTimer } from "../../src/core/session-timer";

describe("monotonic session timer", () => {
  it("enters close-out while a previously observed website timer is not refreshed", () => {
    let now = 0; const timer = new SessionTimer(() => now);
    expect(timer.remaining()).toBeNull();
    timer.observe(80); now = 21000;
    expect(timer.remaining()).toBe(59); expect(timer.closing()).toBe(true);
    expect(timer.solveMilliseconds()).toBe(54000);
    now = 79000; expect(timer.solveMilliseconds()).toBe(0);
  });
  it("cannot renew an old deadline with a stalled, absent or invalid website timer", () => {
    let now = 0; const timer = new SessionTimer(() => now);
    timer.observe(60); now = 10000;
    for (const value of [60, null, undefined, NaN, -1]) timer.observe(value);
    expect(timer.remaining()).toBe(50);
    timer.observe(10); expect(timer.remaining()).toBe(10);
    now = 30000; expect(timer.remaining()).toBe(0);
  });
});
