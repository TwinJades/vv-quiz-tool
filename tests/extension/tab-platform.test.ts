import { afterEach, describe, expect, it, vi } from "vitest";

import { TabPlatformProxy } from "../../src/extension/tab-platform";

afterEach(() => vi.unstubAllGlobals());

describe("semantic snapshot session input", () => {
  it("prioritizes a standalone Canvas in screenshot mode before reading surrounding settings as questions", async () => {
    const sendMessage=vi.fn(async (_tabId:number,request:{type:string})=>({ok:true,result:request.type==='VV_VISUAL_GEOMETRY'?{canvas_surface:true,blocker:null}:{ready:true}}));
    vi.stubGlobal('chrome',{scripting:{executeScript:vi.fn(async()=>[{frameId:0}])},tabs:{sendMessage}});
    const platform=new TabPlatformProxy(1,'visual_snapshot',undefined,vi.fn());
    await expect(platform.waitUntilReady(new AbortController().signal)).resolves.toEqual({ready:true});
    expect(sendMessage.mock.calls.map(call=>call[1].type)).toEqual(['VV_VISUAL_GEOMETRY']);
    // Once selected, readiness uses the visual adapter without a DOM question.
    expect(platform.capabilities().coordinate_targeting).toBe(true);
  });

  it("does not bypass a hard blocker to activate standalone Canvas", async () => {
    const sendMessage=vi.fn(async()=>({ok:true,result:{canvas_surface:true,blocker:'captcha'}}));
    vi.stubGlobal('chrome',{scripting:{executeScript:vi.fn(async()=>[{frameId:0}])},tabs:{sendMessage}});
    const platform=new TabPlatformProxy(1,'visual_snapshot',undefined,vi.fn());
    await expect(platform.waitUntilReady(new AbortController().signal)).resolves.toEqual({ready:false,reason:'captcha'});
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
  it("passes cancellation to structure recognition and releases an uncooperative response without applying late roles", async () => {
    const snapshot = { visible_text: "Choose Alpha", candidates: [{ semantic_id: "region_1", kind: "region", text: "Choose Alpha" }] };
    const sendMessage = vi.fn(async (_tabId: number, request: { type: string }) => request.type === "VV_CAPTURE_SEPARATION"
      ? { ok: true, result: { suggested: true, snapshot } }
      : { ok: false, error: "No supported question was found." });
    vi.stubGlobal("chrome", { tabs: { sendMessage } });
    let release!: (roles: { region_id: string; option_ids: string[] }) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const calibrate = vi.fn((_snapshot: unknown, _signal: AbortSignal) => { started(); return new Promise<{ region_id: string; option_ids: string[] }>(resolve => { release = resolve; }); });
    const platform = new TabPlatformProxy(1, "semantic_snapshot", calibrate);
    const controller = new AbortController();
    const outcome = platform.observeSession("s1", controller.signal).catch(error => error);
    await ready;
    expect(calibrate).toHaveBeenCalledWith(snapshot, controller.signal);
    controller.abort();
    expect(await outcome).toMatchObject({ name: "AbortError" });
    release({ region_id: "region_1", option_ids: ["a", "b"] });
    await Promise.resolve();
    expect(sendMessage.mock.calls.map(call => call[1].type)).toEqual(["VV_OBSERVE", "VV_CAPTURE_SEPARATION"]);
  });
  it("binds manual protection across frames and rotates it only on explicit resume", async () => {
    const sendMessage = vi.fn(async (_tabId: number, request: { type: string }) => ({ ok: true, result: request.type === "VV_WAIT_READY" ? { ready: true } : true }));
    vi.stubGlobal("chrome", { scripting: { executeScript: vi.fn(async () => [{ frameId: 0 }, { frameId: 8 }]) }, tabs: { sendMessage } });
    const platform = new TabPlatformProxy(1);
    await platform.enableInteraction("s1");
    const firstBinding = (sendMessage.mock.calls[0]![1] as unknown as { binding: { epoch: string } }).binding;
    expect(platform.interactionMatches("s1", firstBinding.epoch)).toBe(true);
    expect(sendMessage.mock.calls.length).toBe(2);
    await platform.waitUntilReady(new AbortController().signal);
    expect(platform.interactionMatches("s1", firstBinding.epoch)).toBe(true);
    await platform.disableInteraction();
    expect(platform.interactionMatches("s1", firstBinding.epoch)).toBe(false);
    await platform.enableInteraction("s1");
    expect(platform.interactionMatches("s1", firstBinding.epoch)).toBe(false);
  });

  it("does not send an action after the running session was cancelled", () => {
    const sendMessage = vi.fn();
    vi.stubGlobal("chrome", { tabs: { sendMessage } });
    const controller = new AbortController();
    controller.abort();
    const platform = new TabPlatformProxy(1);
    expect(() => platform.execute({} as never, {} as never, controller.signal)).toThrow();
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it("retries a temporary image network failure before solving", async () => {
    const sendMessage = vi.fn(async () => ({
      ok: true,
      result: [{ temporary_handle: "image_1", source_url: "https://h5p.org/image.png", mime_type: "image/png" }],
    }));
    const fetchImage = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }));
    vi.stubGlobal("chrome", { tabs: { sendMessage } });
    vi.stubGlobal("fetch", fetchImage);
    const platform = new TabPlatformProxy(1);
    const media = await platform.resolveMedia(["image_1"], new AbortController().signal);
    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(Array.from(media[0]!.data)).toEqual([1, 2, 3]);
  });

  it("uses the sole ready iframe for an embedded quiz", async () => {
    const sendMessage = vi.fn(async (_tabId: number, request: { type: string }, options: { frameId: number }) => ({
      ok: true,
      result: request.type === "VV_WAIT_READY" ? { ready: true } : { fingerprint: `frame-${options.frameId}` },
    }));
    vi.stubGlobal("chrome", {
      scripting: { executeScript: vi.fn(async () => [{ frameId: 0 }, { frameId: 8 }]) },
      tabs: { sendMessage },
    });
    const platform = new TabPlatformProxy(1);
    await expect(platform.waitUntilReady(new AbortController().signal)).resolves.toEqual({ ready: true });
    await expect(platform.readState(new AbortController().signal)).resolves.toEqual({ fingerprint: "frame-8" });
  });

  it("sends the page context only on the first question when local extraction stays valid", async () => {
    const modes: string[] = [];
    const sendMessage = vi.fn(async (_tabId: number, request: { type: string; mode?: string }) => {
      if (request.type === "VV_CAPTURE_SEPARATION") {
        return { ok: true, result: { suggested: false, snapshot: { visible_text: "", candidates: [] } } };
      }
      modes.push(request.mode!);
      return { ok: true, result: {
        surface_origin: "https://quiz.example",
        ...(request.mode === "semantic_snapshot" ? { page_context: { mode: "semantic_snapshot", visible_text: "page", controls: [], media: [] } } : {}),
      } };
    });
    vi.stubGlobal("chrome", { tabs: { sendMessage } });
    const platform = new TabPlatformProxy(1, "semantic_snapshot");

    const first = await platform.observeSession("s1", new AbortController().signal);
    const second = await platform.observeSession("s1", new AbortController().signal);

    expect(modes).toEqual(["semantic_snapshot", "structured"]);
    expect(first.page_context?.visible_text).toBe("page");
    expect(second.page_context).toBeUndefined();
  });

  it("sends another semantic snapshot when the question structure changes", async () => {
    const modes: string[] = [];
    const shapes = [2, 2, 3, 3];
    const sendMessage = vi.fn(async (_tabId: number, request: { type: string; mode?: string }) => {
      modes.push(request.mode!);
      const optionCount = shapes[modes.length - 1]!;
      return { ok: true, result: {
        surface_origin: "https://quiz.example",
        questions: [{ question: { type: "single_choice", options: Array(optionCount).fill({}), blanks: [] } }],
        local_control_candidates: [{ semantic_id: "next", text: "Next", disabled: false }],
        ...(request.mode === "semantic_snapshot" ? { page_context: { mode: "semantic_snapshot", visible_text: "page", controls: [], media: [] } } : {}),
      } };
    });
    vi.stubGlobal("chrome", { tabs: { sendMessage } });
    const platform = new TabPlatformProxy(1, "semantic_snapshot");

    await platform.observeSession("s1", new AbortController().signal);
    await platform.observeSession("s1", new AbortController().signal);
    const changed = await platform.observeSession("s1", new AbortController().signal);

    expect(modes).toEqual(["semantic_snapshot", "structured", "structured", "semantic_snapshot"]);
    expect(changed.page_context?.visible_text).toBe("page");
  });

  it("uses a validated separation snapshot when the initial DOM observation has no question", async () => {
    let calibrated = false;
    const snapshot = { visible_text: "Which language is compiled?", candidates: [
      { semantic_id: "region_1", kind: "region", text: "Which language is compiled?" },
      { semantic_id: "region_1_option_1", kind: "option", text: "C" },
      { semantic_id: "region_1_option_2", kind: "option", text: "CSS" },
    ] };
    const sendMessage = vi.fn(async (_tabId: number, request: { type: string; mode?: string }) => {
      if (request.type === "VV_CAPTURE_SEPARATION") return { ok: true, result: { suggested: true, snapshot } };
      if (request.type === "VV_APPLY_SEPARATION") { calibrated = true; return { ok: true, result: { origin: "https://quiz.example" } }; }
      if (!calibrated) return { ok: false, error: "No supported question was found." };
      return { ok: true, result: {
        surface_origin: "https://quiz.example",
        questions: [{ question: { type: "single_choice", options: [{}, {}], blanks: [] } }],
        page_context: { mode: request.mode, visible_text: snapshot.visible_text, controls: [], media: [] },
      } };
    });
    const calibrate = vi.fn(async () => ({ region_id: "region_1", option_ids: ["region_1_option_1", "region_1_option_2"] }));
    vi.stubGlobal("chrome", { tabs: { sendMessage } });
    const platform = new TabPlatformProxy(1, "semantic_snapshot", calibrate);

    const observation = await platform.observeSession("s1", new AbortController().signal);

    expect(calibrate).toHaveBeenCalledOnce();
    expect(observation.page_context?.visible_text).toBe(snapshot.visible_text);
    expect(sendMessage.mock.calls.map((call) => call[1].type)).toEqual([
      "VV_OBSERVE", "VV_CAPTURE_SEPARATION", "VV_APPLY_SEPARATION", "VV_OBSERVE",
    ]);
  });

  it("allows a sole separation candidate past readiness timeout but preserves hard blockers", async () => {
    let blocker = false;
    const sendMessage = vi.fn(async (_tabId: number, request: { type: string }) => {
      if (request.type === "VV_WAIT_READY") return { ok: true, result: { ready: false, reason: blocker ? "unsupported_subjective_question" : "readiness_timeout" } };
      return { ok: true, result: { suggested: true, snapshot: { visible_text: "Question?", candidates: [{ semantic_id: "region_1", kind: "region", text: "Question?" }] } } };
    });
    vi.stubGlobal("chrome", { scripting: { executeScript: vi.fn(async () => [{ frameId: 0 }]) }, tabs: { sendMessage } });
    const platform = new TabPlatformProxy(1, "semantic_snapshot", vi.fn());

    await expect(platform.waitUntilReady(new AbortController().signal)).resolves.toEqual({ ready: true });
    blocker = true;
    await expect(platform.waitUntilReady(new AbortController().signal)).resolves.toEqual({ ready: false, reason: "unsupported_subjective_question" });
  });
});
