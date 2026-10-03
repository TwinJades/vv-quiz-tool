// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { InteractionGuard } from "../../src/extension/interaction-guard";
import type { VisualGeometry } from "../../src/core/visual";

describe("manual quiz interaction", () => {
  function visualGeometry(): VisualGeometry {
    const view = document.defaultView!;
    return { url: view.location.href, time_origin: view.performance.timeOrigin,
      viewport: { width: view.innerWidth, height: view.innerHeight, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 },
      scroll: { x: view.scrollX, y: view.scrollY }, region: { x: 50, y: 50, width: 200, height: 100 }, blocker: null };
  }
  function setup() {
    const target = document.createElement("button");
    const notify = vi.fn();
    const guard = new InteractionGuard(document, item => item === target, notify);
    guard.configure({ session_id: "s1", epoch: "first", enabled: true });
    return { guard, target, notify };
  }

  it("ignores synthetic automation and interaction outside the quiz", () => {
    const { guard, target, notify } = setup();
    guard.handle({ type: "pointerdown", target, isTrusted: false });
    guard.handle({ type: "pointerdown", target: document.body, isTrusted: true });
    guard.handle({ type: "keydown", target, isTrusted: true, key: "Tab" });
    expect(guard.signal("s1", "first").aborted).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(["pointerdown", "keydown", "beforeinput", "input", "change"])("blocks before the worker receives %s, and reports only once", type => {
    const { guard, target, notify } = setup();
    const pending = guard.signal("s1", "first");
    guard.handle({ type, target, isTrusted: true, key: "a" });
    guard.handle({ type, target, isTrusted: true, key: "a" });
    expect(pending.aborted).toBe(true);
    expect(() => guard.signal("s1", "first")).toThrow("USER_INTERACTION");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("keeps the manual latch through reinjection and permits only an explicit new run", () => {
    const { guard, target } = setup();
    guard.handle({ type: "input", target, isTrusted: true });
    guard.configure({ session_id: "s1", epoch: "first", enabled: true });
    expect(() => guard.signal("s1", "first")).toThrow("USER_INTERACTION");
    guard.configure({ session_id: "s1", epoch: "resumed", enabled: true });
    guard.configure({ session_id: "s1", epoch: "first", enabled: false });
    expect(guard.signal("s1", "resumed").aborted).toBe(false);
    expect(() => guard.signal("s1", "first")).toThrow("inactive session");
    expect(() => guard.signal("s2", "resumed")).toThrow("inactive session");
  });

  it("ignores only synchronous native change caused by automation, with no delay window", () => {
    const { guard, target, notify } = setup();
    guard.runAutomation(() => {
      guard.handle({ type: "input", target, isTrusted: true });
      guard.handle({ type: "change", target, isTrusted: true });
    });
    expect(notify).not.toHaveBeenCalled();
    guard.handle({ type: "input", target, isTrusted: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("recognizes retargeted input inside an open shadow root", () => {
    const { guard, target, notify } = setup();
    guard.handle({ type: "input", target: document.body, isTrusted: true, composedPath: () => [target, document.body, document] });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(() => guard.signal("s1", "first")).toThrow("USER_INTERACTION");
  });

  it("allows only the identified native command, while a same-key human event still pauses", () => {
    const { guard, target, notify } = setup();
    const timestamp = Date.now() + 10_000;
    guard.armNativeInput({ session_id: "s1", epoch: "first", enabled: true, nonce: "one", kind: "keyboard",
      timestamp, expires_at: Date.now() + 3000, expected_text: "A" });
    guard.handle({ type: "keydown", key: "A", target, isTrusted: true, timeStamp: timestamp - performance.timeOrigin });
    guard.handle({ type: "beforeinput", target, isTrusted: true, inputType: "insertText", data: "A" });
    guard.handle({ type: "input", target, isTrusted: true, inputType: "insertText", data: "A" });
    expect(notify).not.toHaveBeenCalled();
    guard.handle({ type: "keydown", key: "A", target, isTrusted: true, timeStamp: Date.now() - performance.timeOrigin });
    expect(notify).toHaveBeenCalledOnce();
    expect(() => guard.signal("s1", "first")).toThrow("USER_INTERACTION");
  });

  it("pauses retargeted pointer input in an observed closed-shadow visual region", () => {
    const host = document.createElement("closed-quiz");
    host.attachShadow({ mode: "closed" }).appendChild(document.createElement("input"));
    const notify = vi.fn();
    const guard = new InteractionGuard(document, () => false, notify);
    const binding = { session_id: "s", epoch: "e", enabled: true };
    guard.configure(binding);
    guard.protectVisualScope(binding, visualGeometry());
    guard.handle({ type: "pointerdown", target: host, isTrusted: true, clientX: 60, clientY: 60 });
    expect(notify).toHaveBeenCalledOnce();
    expect(() => guard.signal("s", "e")).toThrow("USER_INTERACTION");
    expect(host.shadowRoot).toBeNull();
  });

  it("uses host bounds for visual keyboard input, without examining the closed root", () => {
    const host = document.createElement("closed-quiz");
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 50, 200, 100));
    const notify = vi.fn();
    const guard = new InteractionGuard(document, () => false, notify);
    const binding = { session_id: "s", epoch: "e", enabled: true };
    guard.configure(binding);
    guard.protectVisualScope(binding, visualGeometry());
    guard.handle({ type: "keydown", target: host, key: "A", isTrusted: true });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("ignores outside/navigation input and discards visual scope when the run changes", () => {
    const host = document.createElement("closed-quiz");
    const nav = document.createElement("nav");
    const menu = nav.appendChild(document.createElement("button"));
    const notify = vi.fn();
    const guard = new InteractionGuard(document, () => false, notify);
    const binding = { session_id: "s", epoch: "e", enabled: true };
    guard.configure(binding);
    guard.protectVisualScope(binding, visualGeometry());
    guard.handle({ type: "pointerdown", target: host, isTrusted: true, clientX: 20, clientY: 20 });
    guard.handle({ type: "pointerdown", target: menu, isTrusted: true, clientX: 60, clientY: 60 });
    expect(notify).not.toHaveBeenCalled();
    guard.configure({ ...binding, epoch: "resumed" });
    expect(() => guard.protectVisualScope(binding, visualGeometry())).toThrow("inactive session");
    guard.handle({ type: "pointerdown", target: host, isTrusted: true, clientX: 60, clientY: 60 });
    expect(notify).not.toHaveBeenCalled();
  });
});
