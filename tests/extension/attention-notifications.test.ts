import { describe, expect, it } from "vitest";
import { SessionAttentionNotifications } from "../../src/extension/attention-notifications";
describe("session attention notices", () => {
  it("announces close-out once across repeated states and pause/resume", () => {
    const policy = new SessionAttentionNotifications();
    const closing = { state: "CLOSE_OUT", strategy: "unattended", notice: null } as const;
    expect(policy.next(closing)?.title).toBe("VV 正在收尾");
    expect(policy.next(closing)).toBeNull();
    policy.next({ ...closing, state: "ACT" });
    expect(policy.next(closing)).toBeNull();
    expect(policy.next({ ...closing, state: "PAUSED", notice: "Paused by user." })?.message).toBe("已按用户要求暂停。");
    policy.next({ ...closing, state: "QUEUED" });
    expect(policy.next(closing)).toBeNull();
  });
  it("notifies close-out independently in each session", () => {
    const policy = new SessionAttentionNotifications();
    expect(policy.next({ state: "CLOSE_OUT", strategy: "unattended", notice: null })).not.toBeNull();
    expect(policy.next({ state: "CLOSE_OUT", strategy: "unattended", notice: null })).toBeNull();
    expect(new SessionAttentionNotifications().next({ state: "CLOSE_OUT", strategy: "unattended", notice: null })).not.toBeNull();
  });
  it("deduplicates repeated failure or pause updates and notifies a new incident after resuming", () => {
    const policy = new SessionAttentionNotifications();
    const paused = { state: "PAUSED", strategy: "unattended", notice: "Provider unavailable" } as const;
    expect(policy.next(paused)?.message).toBe("模型服务请求未完成，请检查接口、授权和额度。");
    expect(policy.next(paused)).toBeNull();
    policy.next({ ...paused, state: "SOLVE" });
    expect(policy.next(paused)).not.toBeNull();
    expect(policy.next({ ...paused, state: "FAILED" })?.title).toBe("VV 运行失败");
    expect(policy.next({ ...paused, state: "FAILED" })).toBeNull();
    expect(policy.next({ ...paused, state: "COMPLETE" })).toBeNull();
  });
});
