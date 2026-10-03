import { describe, expect, it } from "vitest";
import { SessionAttentionNotifications } from "../../src/extension/attention-notifications";
describe("session attention notices", () => {
  it("announces supervised close-out once across repeated states and pause/resume", () => {
    const policy = new SessionAttentionNotifications();
    const closing = { state: "CLOSE_OUT", strategy: "supervised", notice: null } as const;
    expect(policy.next(closing)?.title).toBe("VV 正在收尾");
    expect(policy.next(closing)).toBeNull();
    policy.next({ ...closing, state: "ACT" });
    expect(policy.next(closing)).toBeNull();
    expect(policy.next({ ...closing, state: "PAUSED", notice: "Manual pause" })?.message).toBe("Manual pause");
    policy.next({ ...closing, state: "QUEUED" });
    expect(policy.next(closing)).toBeNull();
  });
  it("does not notify unattended close-out but allows a subsequent switch to supervision", () => {
    const policy = new SessionAttentionNotifications();
    expect(policy.next({ state: "CLOSE_OUT", strategy: "unattended", notice: null })).toBeNull();
    expect(policy.next({ state: "CLOSE_OUT", strategy: "supervised", notice: null })).not.toBeNull();
    expect(new SessionAttentionNotifications().next({ state: "CLOSE_OUT", strategy: "supervised", notice: null })).not.toBeNull();
  });
  it("deduplicates repeated failure or pause updates and notifies a new incident after resuming", () => {
    const policy = new SessionAttentionNotifications();
    const paused = { state: "PAUSED", strategy: "unattended", notice: "Provider unavailable" } as const;
    expect(policy.next(paused)?.message).toBe(paused.notice);
    expect(policy.next(paused)).toBeNull();
    policy.next({ ...paused, state: "SOLVE" });
    expect(policy.next(paused)).not.toBeNull();
    expect(policy.next({ ...paused, state: "FAILED" })?.title).toBe("VV session failed");
    expect(policy.next({ ...paused, state: "FAILED" })).toBeNull();
    expect(policy.next({ ...paused, state: "COMPLETE" })).toBeNull();
  });
});
