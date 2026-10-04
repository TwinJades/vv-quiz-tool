import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualTransport } from "../../src/extension/visual-transport";
import type { VisualGeometry } from "../../src/core/visual";

// Real queue/transport implementation with deterministic browser pixels. The
// browser regression separately verifies native CDP and actual PNG rendering.
describe("visual input after waiting for the shared transport queue", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  function setup() {
    let pixel = 1;
    let release: (() => void) | null = null;
    let holdNext = false;
    let failShot = false;
    const commands: string[] = [];
    let pointerReleased!: () => void;
    const waitForPointerRelease=new Promise<void>(resolve=>{pointerReleased=resolve;});
    const geometry: VisualGeometry = { url: "https://quiz.test/", time_origin: 100,
      viewport: { width: 100, height: 100, dpr: 1, scale: 1, offset_x: 0, offset_y: 0 },
      scroll: { x: 0, y: 0 }, region: { x: 0, y: 0, width: 100, height: 100 }, blocker: null };
    vi.stubGlobal("chrome", {
      debugger: { attach: vi.fn(async () => {}), detach: vi.fn(async () => {}),
        onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
        sendCommand: vi.fn(async (_target, method: string, params?: {type?:string}) => {
          commands.push(method);
          if(method==='Input.dispatchMouseEvent'&&params?.type==='mouseReleased')pointerReleased();
          if (method === "Page.captureScreenshot") {
            if (failShot) { failShot = false; throw new Error("capture failed"); }
            if (holdNext) { holdNext = false; await new Promise<void>(resolve => { release = resolve; }); }
            return { data: btoa(String.fromCharCode(pixel)) };
          }
          return {};
        }) },
      webNavigation: { getAllFrames: vi.fn(async () => []) },
      permissions: { contains: vi.fn(async () => true) },
      tabs: { getZoom: vi.fn(async () => 1) },
    });
    vi.stubGlobal("createImageBitmap", async (blob: Blob) => ({ width: 100, height: 100,
      pixel: new Uint8Array(await blob.arrayBuffer())[0]!, close: () => {} }));
    vi.stubGlobal("OffscreenCanvas", class {
      pixel = 0;
      getContext() { return {
        drawImage: (image: { pixel: number }) => { this.pixel = image.pixel; },
        getImageData: () => ({ data: new Uint8Array([this.pixel]) }),
      }; }
      async convertToBlob() { return new Blob([new Uint8Array([this.pixel])]); }
    });
    const binding = { session_id: "s", epoch: "epoch", enabled: true };
    const transport = new VisualTransport(1, async () => structuredClone(geometry), () => binding, async () => {});
    return { transport, commands, waitForPointerRelease, change: () => { pixel++; },
      failCapture: () => { failShot = true; },
      hold: () => { holdNext = true; },
      waitUntilHeld: async () => { while (!release) await new Promise(resolve => setTimeout(resolve, 0)); },
      release: () => { release?.(); }, binding, geometry };
  }
  const signal = () => new AbortController().signal;

  it('retains the original viewport on the first crop and checks the same scope before native input',async()=>{
    const test=setup();
    test.geometry.isolated_canvas=true;
    test.geometry.region={x:8,y:10,width:60,height:50};
    const first=await test.transport.capture('s','o',signal());
    expect(first.frame).toMatchObject({width:60,height:50,geometry:{region:{x:8,y:10,width:60,height:50}}});
    expect(first.viewport_context).toMatchObject({width:100,height:100,data:new Uint8Array([1])});
    const second=await test.transport.capture('s','o',signal());
    expect(second.viewport_context).toBeUndefined();
    await test.transport.click({x:38,y:35},signal(),second.frame);
    expect(vi.mocked(chrome.debugger.sendCommand).mock.calls.find(call=>call[1]==='Input.dispatchMouseEvent')?.[2]).toMatchObject({x:38,y:35});
    test.geometry.region={x:0,y:0,width:100,height:100};test.geometry.isolated_canvas=false;
    const pointers=test.commands.filter(command=>command==='Input.dispatchMouseEvent').length;
    await expect(test.transport.click({x:38,y:35},signal(),second.frame)).rejects.toThrow('PAGE_CHANGED');
    expect(test.commands.filter(command=>command==='Input.dispatchMouseEvent')).toHaveLength(pointers);
    await test.transport.close();
  });

  it("keeps the frame producer through Canvas input and releases it when a render wait is cancelled", async () => {
    const test=setup();test.geometry.canvas_surface=true;
    const frame=(await test.transport.capture("s","o",signal())).frame;
    test.commands.length=0;
    vi.useFakeTimers();
    const controller=new AbortController();
    const clicked=test.transport.click({x:10,y:10},controller.signal,frame);
    const outcome=clicked.then(()=>null,error=>error);
    try {
      // Crypto hashing settles on the real event loop, not the fake clock.
      // Await the actual native release instead of guessing 100 timer ticks.
      await Promise.race([test.waitForPointerRelease,outcome.then(error=>{throw error??new Error('Input completed before the native release');})]);
      await vi.advanceTimersByTimeAsync(0);
      expect(test.commands).toContain("Input.dispatchMouseEvent");
      expect(test.commands.filter(command=>command === "Page.startScreencast")).toHaveLength(1);
      expect(test.commands).not.toContain("Page.stopScreencast");
      controller.abort(new Error("cancel render"));
      expect(await outcome).toMatchObject({message:'cancel render'});
      expect(test.commands).toContain("Page.stopScreencast");
      expect(vi.getTimerCount()).toBe(0);
    }finally{controller.abort(new Error('test cleanup'));await outcome;await test.transport.close();}
  });

  it("refuses a native pointer outside the regions whose pixels will be checked", async () => {
    const test=setup();
    const frame=(await test.transport.capture("s","o",signal())).frame;
    frame.validated_regions=[{x:40,y:40,width:20,height:20}];
    await expect(test.transport.click({x:10,y:10},signal(),frame)).rejects.toThrow("outside the protected");
    expect(test.commands).not.toContain("Input.dispatchMouseEvent");
    await test.transport.close();
  });

  it("rejects changed pixels after the action waits, without sending any pointer event", async () => {
    const test = setup();
    const frame = (await test.transport.capture("s", "o", signal())).frame;
    test.hold();
    const busy = test.transport.capture("s", "busy", signal());
    await test.waitUntilHeld();
    const clicked = test.transport.click({ x: 10, y: 10 }, signal(), frame);
    const rejected = expect(clicked).rejects.toThrow("PAGE_CHANGED");
    test.change();
    test.release();
    await busy;
    await rejected;
    expect(test.commands).not.toContain("Input.dispatchMouseEvent");
    expect(test.transport.captureCount()).toBe(3);
    await test.transport.close();
  });

  it("rejects a disabled session after waiting and does not send keyboard input", async () => {
    const test = setup();
    const frame = (await test.transport.capture("s", "o", signal())).frame;
    test.hold();
    const busy = test.transport.capture("s", "busy", signal());
    await test.waitUntilHeld();
    const typed = test.transport.replaceText("Alpha", signal(), frame);
    const rejected = expect(typed).rejects.toThrow("inactive session");
    test.binding.enabled = false;
    test.release();
    await busy;
    await rejected;
    expect(test.commands).not.toContain("Input.dispatchKeyEvent");
    await test.transport.close();
  });

  it("validates once inside the lease before sending a complete keyboard replacement", async () => {
    const test = setup();
    const frame = (await test.transport.capture("s", "o", signal())).frame;
    await test.transport.replaceText("AB", signal(), frame);
    expect(test.transport.captureCount()).toBe(2);
    expect(test.commands.filter(command => command === "Input.dispatchKeyEvent")).toHaveLength(8);
    const lastCapture = test.commands.lastIndexOf("Page.captureScreenshot");
    expect(test.commands.slice(lastCapture + 1).filter(command => command === "Input.dispatchKeyEvent")).toHaveLength(8);
    await test.transport.close();
  });

  it("discards temporary stream pixels and acknowledges only this tab during capture", async () => {
    const test = setup();
    test.hold();
    const capture = test.transport.capture("s", "o", signal());
    await test.waitUntilHeld();
    const listener = vi.mocked(chrome.debugger.onEvent.addListener).mock.calls[0]![0]!;
    listener({ tabId: 2 }, "Page.screencastFrame", { sessionId: 7, data: "other-tab" });
    listener({ tabId: 1 }, "Page.screencastFrame", { sessionId: 7, data: "discard-pixels" });
    expect(test.commands.filter(command => command === "Page.screencastFrameAck")).toHaveLength(1);
    expect(vi.mocked(chrome.debugger.sendCommand).mock.calls.find(call => call[1] === "Page.screencastFrameAck")?.[2]).toEqual({ sessionId: 7 });
    test.release();
    await capture;
    listener({ tabId: 1 }, "Page.screencastFrame", { sessionId: 8 });
    expect(test.commands.filter(command => command === "Page.screencastFrameAck")).toHaveLength(1);
    expect(test.commands).toContain("Page.stopScreencast");
    await test.transport.close();
    expect(chrome.debugger.onEvent.removeListener).toHaveBeenCalledWith(listener);
  });

  it("detaches and removes the temporary frame listener if capture fails", async () => {
    const test = setup();
    test.failCapture();
    await expect(test.transport.capture("s", "o", signal())).rejects.toThrow("capture failed");
    await test.transport.close();
    expect(chrome.debugger.detach).toHaveBeenCalledOnce();
    expect(chrome.debugger.onEvent.removeListener).toHaveBeenCalledOnce();
    expect(test.commands).not.toContain("Input.dispatchMouseEvent");
  });

  it("releases a late successful attach after cancellation before a newer session can attach", async () => {
    const test = setup();
    let finishAttach!: () => void;
    vi.mocked(chrome.debugger.attach).mockImplementationOnce(() => new Promise<void>(resolve => { finishAttach = resolve; }));
    const controller = new AbortController();
    const oldCapture = test.transport.capture("s", "old", controller.signal);
    const cancelled = expect(oldCapture).rejects.toThrow();
    await vi.waitFor(() => expect(chrome.debugger.attach).toHaveBeenCalledOnce());
    controller.abort(); await cancelled;
    const next = new VisualTransport(1, async () => test.geometry, () => test.binding, async () => {});
    const newCapture = next.capture("s", "new", signal());
    await Promise.resolve();
    expect(chrome.debugger.attach).toHaveBeenCalledOnce();
    finishAttach(); await newCapture;
    expect(chrome.debugger.attach).toHaveBeenCalledTimes(2);
    expect(chrome.debugger.detach).toHaveBeenCalledOnce();
    expect(chrome.debugger.onEvent.addListener).toHaveBeenCalledOnce();
    await test.transport.close(); await next.close();
    expect(chrome.debugger.detach).toHaveBeenCalledTimes(2);
  });

  it("keeps late attach cleanup after its bounded observation timeout", async () => {
    vi.useFakeTimers(); const test = setup(); let finishAttach!: () => void;
    vi.mocked(chrome.debugger.attach).mockImplementationOnce(() => new Promise<void>(resolve => { finishAttach = resolve; }));
    const capture = test.transport.capture("s", "old", signal());
    const rejected = expect(capture).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15001); await rejected;
    finishAttach(); await vi.advanceTimersByTimeAsync(0); await test.transport.close();
    expect(chrome.debugger.detach).toHaveBeenCalledOnce();
    expect(chrome.debugger.onEvent.addListener).not.toHaveBeenCalled();
    expect(test.commands).not.toContain("Page.captureScreenshot");
  });

  it("closes a pending attach without installing listeners or acquiring a screenshot lease", async () => {
    const test = setup(); let finishAttach!: () => void;
    vi.mocked(chrome.debugger.attach).mockImplementationOnce(() => new Promise<void>(resolve => { finishAttach = resolve; }));
    const capture = test.transport.capture("s", "old", signal());
    const rejected = expect(capture).rejects.toThrow("released");
    await vi.waitFor(() => expect(chrome.debugger.attach).toHaveBeenCalledOnce());
    const closing = test.transport.close(); finishAttach();
    await closing; await rejected; await test.transport.close();
    expect(chrome.debugger.detach).toHaveBeenCalledOnce();
    expect(chrome.debugger.onEvent.addListener).not.toHaveBeenCalled();
    expect(test.commands).toEqual([]);
  });
});
