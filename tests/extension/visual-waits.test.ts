import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualTransport } from "../../src/extension/visual-transport";
import type { VisualGeometry } from "../../src/core/visual";

const stages = ["geometry", "frames", "permission", "zoom", "geometry_verification", "zoom_verification"] as const;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function stalled(stage: typeof stages[number]) {
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let used = false;
  const counts: Record<string, number> = {};
  const gate = async (name: "geometry" | "frames" | "permission" | "zoom") => {
    const count = counts[name] = (counts[name] ?? 0) + 1;
    if (!used && ((name === stage && count === 1) || (stage === name + "_verification" && count === 2))) {
      used = true; entered(); await held;
    }
  };
  const geometry: VisualGeometry = { url: "https://quiz.test/", time_origin: 1,
    viewport: { width: 100, height: 100, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 },
    scroll: { x: 0, y: 0 }, region: { x: 0, y: 0, width: 100, height: 100 }, blocker: null };
  const commands: Array<{ tab: number; method: string }> = [];
  vi.stubGlobal("chrome", {
    debugger: { attach: vi.fn(async () => {}), detach: vi.fn(async () => {}),
      onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
      sendCommand: vi.fn(async (target: {tabId: number}, method: string) => {
        commands.push({tab: target.tabId, method});
        return method === "Page.captureScreenshot" ? {data: btoa("x")} : {};
      }) },
    webNavigation: { getAllFrames: vi.fn(async () => { await gate("frames"); return []; }) },
    permissions: { contains: vi.fn(async () => { await gate("permission"); return true; }) },
    tabs: { getZoom: vi.fn(async () => { await gate("zoom"); return 1; }) },
  });
  vi.stubGlobal("createImageBitmap", async () => ({width:100, height:100, close: () => {}}));
  vi.stubGlobal("OffscreenCanvas", class {
    getContext() { return {drawImage: () => {}, getImageData: () => ({data: new Uint8Array([1])})}; }
    async convertToBlob() { return new Blob([new Uint8Array([1])]); }
  });
  const binding = {session_id:"s", epoch:"e", enabled:true};
  const old = new VisualTransport(10, async () => { await gate("geometry"); return geometry; }, () => binding, async () => {});
  const next = new VisualTransport(11, async () => geometry, () => binding, async () => {});
  return {old, next, enteredPromise, release, commands};
}

describe("slow browser reads must not retain the shared visual queue", () => {
  it.each(stages)("cancels a pending %s read and admits another tab before the late reply", async stage => {
    const test = stalled(stage);
    const controller = new AbortController();
    let error: unknown;
    const old = test.old.capture("s", "old", controller.signal).catch(value => {error = value;});
    await test.enteredPromise;
    const next = test.next.capture("s", "next", new AbortController().signal);
    try {
      controller.abort(new Error("stop slow read"));
      await vi.waitFor(() => expect(error).toMatchObject({message:"stop slow read"}), {timeout:200, interval:10});
      await next;
      expect(test.commands.filter(item => item.tab === 10 && item.method === "Page.captureScreenshot")).toHaveLength(stage.endsWith("_verification") ? 1 : 0);
    } finally {
      test.release();
      await Promise.allSettled([old, next]);
      await test.old.close(); await test.next.close();
    }
  });

  it.each(stages)("bounds a pending %s read and ignores its late reply", async stage => {
    vi.useFakeTimers();
    const test = stalled(stage);
    let error: unknown;
    const old = test.old.capture("s", "old", new AbortController().signal).catch(value => {error = value;});
    await test.enteredPromise;
    try {
      await vi.advanceTimersByTimeAsync(15001);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("timed out");
      vi.useRealTimers();
      await test.next.capture("s", "next", new AbortController().signal);
      test.release(); await old;
      expect(test.commands.filter(item => item.tab === 10 && item.method === "Page.captureScreenshot")).toHaveLength(stage.endsWith("_verification") ? 1 : 0);
    } finally {
      vi.useRealTimers(); test.release(); await old;
      await test.old.close(); await test.next.close();
    }
  });
});
