import { assertVisualFreshness, fingerprintVisualTiles, insideRect } from "../core/visual";
import type { VisualCapture, VisualFrame, VisualGeometry } from "../core/visual";
import type { InteractionBinding, NativeInputTicket } from "./interaction-guard";
import { requireCurrentWebsite } from './website-access';

export interface NormalHoverTarget {
  point: { x: number; y: number };
  captured_at: number;
  geometry: VisualGeometry;
  session_id: string;
  interaction_epoch: string;
}
let captureTail: Promise<void> = Promise.resolve();
const connectionTails = new Map<number, Promise<void>>();
function serializedConnection<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  const result = (connectionTails.get(tabId) ?? Promise.resolve()).then(operation);
  const tail = result.then(() => {}, () => {});
  connectionTails.set(tabId, tail);
  void tail.then(() => { if (connectionTails.get(tabId) === tail) connectionTails.delete(tabId); });
  return result;
}
function serializedOperation<T>(capture: () => Promise<T>): Promise<T> {
  const result = captureTail.then(capture);
  captureTail = result.then(() => {}, () => {});
  return result;
}

function bounded<T>(operation: Promise<T>, signal: AbortSignal, label: string): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const abort = () => fail(signal.reason ?? new DOMException("Cancelled.", "AbortError"));
    const timer = setTimeout(() => fail(new Error(`VISUAL_UNAVAILABLE: ${label} timed out.`)), 15000);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(value => { cleanup(); resolve(value); }, fail);
  });
}

// A fixed command surface: no model-provided CDP methods, scripts or selectors.
export class VisualTransport {
  #attached = false;
  #attaching: Promise<void> | null = null;
  #closed = false;
  #closing: Promise<void> | null = null;
  #captures = 0;
  #viewportContextSent = false;
  #streaming = false;
  #listening = false;
  readonly #frameListener = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    if (!this.#streaming || this.#closed || source.tabId !== this.tabId || method !== "Page.screencastFrame") return;
    const sessionId = (params as { sessionId?: unknown } | undefined)?.sessionId;
    if (typeof sessionId !== "number" || !Number.isInteger(sessionId)) return;
    // Discard stream pixels; acknowledge only so the compositor keeps producing
    // the fresh frame requested by captureScreenshot. No stream is stored/uploaded.
    void chrome.debugger.sendCommand(source, "Page.screencastFrameAck", { sessionId }).catch(() => {});
  };
  constructor(readonly tabId: number,
    private readonly geometry: () => Promise<VisualGeometry>,
    private readonly binding: () => InteractionBinding | null,
    private readonly armInput: (ticket: NativeInputTicket | null) => Promise<void>,
  ) {}

  captureCount(): number { return this.#captures; }

  async #withFrames<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const ownsStream=!this.#streaming;
    if(ownsStream) {
      this.#streaming=true;
      try { await this.#send("Page.startScreencast",{format:"png",maxFramesInFlight:1},signal); }
      catch(error) { this.#streaming=false;throw error; }
    }
    try { return await operation(); }
    finally {
      if(ownsStream) {
        this.#streaming=false;
        if(this.#attached) await bounded(chrome.debugger.sendCommand({tabId:this.tabId},"Page.stopScreencast",{}),
          new AbortController().signal,"visual frame release").catch(()=>this.close());
      }
    }
  }

  #renderAfterInput(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const finish=()=>{signal.removeEventListener("abort",cancel);resolve();};
      const cancel=()=>{clearTimeout(timer);signal.removeEventListener("abort",cancel);reject(signal.reason??new DOMException("Cancelled","AbortError"));};
      // Public Canvas marking followed by an end-screen fade can outlast two
      // seconds. Keep this bounded rendering lease long enough for both; the
      // subsequent independent reading still decides whether it completed.
      const timer=setTimeout(finish,4000);
      signal.addEventListener("abort",cancel,{once:true});
      if(signal.aborted) cancel();
    });
  }

  async #attach(signal: AbortSignal): Promise<void> {
    if (this.#closed) throw new Error("VISUAL_UNAVAILABLE: visual transport is closed.");
    if (this.#attached) return;
    if (!this.#attaching) {
      let abandoned = false;
      const connection = serializedConnection(this.tabId, async () => {
        if (abandoned || this.#closed) throw new Error("VISUAL_UNAVAILABLE: visual connection was closed.");
        signal.throwIfAborted();
        await chrome.debugger.attach({ tabId: this.tabId }, "1.3");
        if (abandoned || this.#closed || signal.aborted) {
          // Keep this tab's connection lease until late attach cleanup actually
          // settles; an older cancellation must never detach a newer session.
          await chrome.debugger.detach({ tabId: this.tabId }).catch(() => {});
          throw new Error("VISUAL_UNAVAILABLE: cancelled visual connection was released.");
        }
        this.#attached = true;
        chrome.debugger.onEvent.addListener(this.#frameListener);
        this.#listening = true;
      });
      this.#attaching = bounded(connection, signal, "visual connection").catch(error => {
        abandoned = true;
        void this.close();
        throw error;
      }).finally(() => { this.#attaching = null; });
    }
    await this.#attaching;
  }

  async #send<T>(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    let result: T;
    try { result = await bounded(chrome.debugger.sendCommand({ tabId: this.tabId }, method, params) as Promise<T>, signal, method); }
    catch (error) { void this.close(); throw error; }
    signal.throwIfAborted();
    return result;
  }

  async capture(sessionId: string, observationId: string, signal: AbortSignal): Promise<VisualCapture> {
    await this.#attach(signal);
    return this.#withFocus(() => this.#capture(sessionId, observationId, signal), signal);
  }

  async #capture(sessionId: string, observationId: string, signal: AbortSignal): Promise<VisualCapture> {
    this.#captures++;
    signal.throwIfAborted();
    const geometry = await bounded(this.geometry(), signal, "visual geometry");
    const frames = await bounded(chrome.webNavigation.getAllFrames({ tabId: this.tabId }), signal, "visual frames");
    const origins = [...new Set([geometry.url, ...(frames ?? []).map(frame => frame.url)].filter(url => /^https?:/.test(url)).map(url => `${new URL(url).origin}/*`))];
    if (!await bounded(chrome.permissions.contains({ origins }), signal, "visual website permission")) throw new Error("VISUAL_UNAVAILABLE: website/frame permission was revoked or is missing.");
    if (geometry.blocker) throw new Error(`HARD_BLOCKER: ${geometry.blocker}`);
    if (!/^https?:/.test(geometry.url) || geometry.viewport.scale !== 1 || geometry.region.width <= 0 || geometry.region.height <= 0) throw new Error("VISUAL_UNAVAILABLE: unsupported viewport or document.");
    const zoom = await bounded(chrome.tabs.getZoom(this.tabId), signal, "visual zoom");
    // A CDP clip temporarily changes device emulation/view size. Capture the
    // target's viewport without changing layout, then crop locally before upload.
    const image=await this.#withFrames(()=>this.#send<{ data: string }>("Page.captureScreenshot", {
        format: "png", fromSurface: true, captureBeyondViewport: false,
      },signal),signal);
    const after = await bounded(this.geometry(), signal, "visual geometry verification");
    if (JSON.stringify(after) !== JSON.stringify(geometry) || await bounded(chrome.tabs.getZoom(this.tabId), signal, "visual zoom verification") !== zoom) throw new Error("PAGE_CHANGED: document changed during screenshot capture.");
    const raw = Uint8Array.from(atob(image.data), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw], { type: "image/png" }));
    try {
      if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 20_000_000) throw new Error("VISUAL_UNAVAILABLE: screenshot exceeds the supported image size.");
      const sx = bitmap.width / geometry.viewport.width;
      const sy = bitmap.height / geometry.viewport.height;
      if (Math.abs(sx - sy) > 0.01) throw new Error("PAGE_CHANGED: captured viewport dimensions do not match the document.");
      const left = Math.round(geometry.region.x * sx), top = Math.round(geometry.region.y * sy);
      const width = Math.round((geometry.region.x + geometry.region.width) * sx) - left;
      const height = Math.round((geometry.region.y + geometry.region.height) * sy) - top;
      if (width <= 0 || height <= 0 || left < 0 || top < 0 || left + width > bitmap.width || top + height > bitmap.height) throw new Error("PAGE_CHANGED: screenshot crop is outside the captured viewport.");
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const digest = await crypto.subtle.digest("SHA-256", pixels);
      const pixel_tiles = await fingerprintVisualTiles(pixels, width, height);
      const data = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      signal.throwIfAborted();
      const viewport_context = !this.#viewportContextSent && geometry.isolated_canvas &&
        (left !== 0 || top !== 0 || width !== bitmap.width || height !== bitmap.height)
        ? { data: raw, width: bitmap.width, height: bitmap.height } : undefined;
      this.#viewportContextSent = true;
      return { frame: { visual_frame_id: crypto.randomUUID(), session_id: sessionId, observation_id: observationId,
        surface_id: `tab_${this.tabId}`, captured_at: Date.now(), geometry, zoom, width, height, ...(pixel_tiles ? {pixel_tiles} : {}),
        fingerprint: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""), temporary_handle: `visual_${crypto.randomUUID()}` }, data,
        ...(viewport_context ? { viewport_context } : {}) };
    } finally { bitmap.close(); }
  }

  async #native(kind: "pointer" | "keyboard", commands: Array<{ method: string; params: Record<string, unknown> }>, signal: AbortSignal,
    expectedFrame: VisualFrame, expectedText?: string): Promise<void> {
    await this.#attach(signal);
    await this.#withFocus(async () => {
      await this.#withFrames(async()=>{
        await this.#validateFrame(expectedFrame, signal);
        await this.#dispatchNative(kind, commands, signal, expectedText);
        // An inactive Canvas may pause its marking/transition animations as
        // soon as frame production ends. Hold target-only rendering briefly;
        // VERIFY still reads actual pixels afterward and can reject the input.
        if(kind === "pointer" && expectedFrame.geometry.canvas_surface) await this.#renderAfterInput(signal);
      },signal);
    }, signal);
  }

  async #validateFrame(expected: VisualFrame, signal: AbortSignal): Promise<void> {
    const binding = this.binding();
    if (!binding?.enabled || binding.session_id !== expected.session_id) throw new Error("USER_INTERACTION: visual frame belongs to an inactive session.");
    // This capture and its native input share the same queue lease. No other
    // session's screenshot/input may slip between the last pixel check and input.
    const current = await this.#capture(expected.session_id, expected.observation_id, signal);
    assertVisualFreshness(expected, current.frame);
  }

  #withFocus<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return serializedOperation(async () => {
      signal.throwIfAborted();
      if (this.#closed) throw new Error("VISUAL_UNAVAILABLE: visual transport is closed.");
      // Target-only focus is held for one native operation. Multiple parallel
      // sessions must not compete for the browser's background rendering focus.
      await this.#send("Emulation.setFocusEmulationEnabled", { enabled: true }, signal);
      try { return await operation(); }
      finally {
        if (this.#attached) await bounded(chrome.debugger.sendCommand({ tabId: this.tabId }, "Emulation.setFocusEmulationEnabled", { enabled: false }),
          new AbortController().signal, "visual focus release").catch(() => {});
      }
    });
  }

  async #dispatchNative(kind: "pointer" | "keyboard", commands: Array<{ method: string; params: Record<string, unknown> }>, signal: AbortSignal,
    expectedText?: string): Promise<void> {
    const binding = this.binding();
    if (!binding?.enabled) throw new Error("USER_INTERACTION: no active visual session.");
    // A future event timestamp identifies this command's trusted input. A real user
    // event has the current timestamp and can never be mistaken for this ticket.
    const timestamp = Date.now() + 10_000 + crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000;
    const ticket: NativeInputTicket = { ...binding, nonce: crypto.randomUUID(), kind, timestamp, expires_at: Date.now() + 3000,
      ...(expectedText !== undefined ? { expected_text: expectedText } : {}) };
    await this.armInput(ticket);
    try {
      for (const command of commands) await this.#send(command.method, { ...command.params, timestamp: timestamp / 1000 }, signal);
    } finally { await this.armInput(null); }
  }

  click(point: { x: number; y: number }, signal: AbortSignal, expectedFrame: VisualFrame): Promise<void> {
    const imagePoint={x:(point.x-expectedFrame.geometry.region.x)*expectedFrame.width/expectedFrame.geometry.region.width,
      y:(point.y-expectedFrame.geometry.region.y)*expectedFrame.height/expectedFrame.geometry.region.height};
    if(expectedFrame.validated_regions && !expectedFrame.validated_regions.some(region=>insideRect(imagePoint,region))) {
      return Promise.reject(new Error("TARGET_UNAVAILABLE: native pointer is outside the protected visual regions."));
    }
    return this.#native("pointer", [
      { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", button: "left", clickCount: 1, ...point } },
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", button: "left", clickCount: 1, ...point } },
    ], signal, expectedFrame);
  }

  /** A locally resolved normal control can require CSS :hover. This separate
   * path never clicks, captures/uploads pixels, emulates focus, produces frames
   * or changes page visibility. No model-provided CDP commands are accepted. */
  hoverNormalControl(target: NormalHoverTarget, signal: AbortSignal): Promise<void> {
    target = structuredClone(target);
    const assertBinding = () => {
      signal.throwIfAborted();
      const binding = this.binding();
      if (!binding?.enabled || binding.session_id !== target.session_id || binding.epoch !== target.interaction_epoch)
        throw new Error('USER_INTERACTION: normal hover belongs to an inactive session.');
      if (!Number.isFinite(target.captured_at) || Date.now() < target.captured_at || Date.now() - target.captured_at > 5000)
        throw new Error('TARGET_UNAVAILABLE: normal hover observation expired.');
    };
    return serializedOperation(async () => {
      assertBinding();
      await requireCurrentWebsite(this.tabId); assertBinding();
      if (!await chrome.permissions.contains({ permissions: ['debugger'] })) throw new Error('正常倍速菜单悬停需要已授权的debugger网页控制权限。');
      assertBinding();
      await this.#attach(signal); assertBinding();
      await requireCurrentWebsite(this.tabId); assertBinding();
      const current = await this.geometry(); assertBinding();
      if (current.blocker || current.url !== target.geometry.url || current.time_origin !== target.geometry.time_origin ||
        JSON.stringify(current.viewport) !== JSON.stringify(target.geometry.viewport) ||
        JSON.stringify(current.scroll) !== JSON.stringify(target.geometry.scroll) ||
        JSON.stringify(current.region) !== JSON.stringify(target.geometry.region) ||
        !Number.isFinite(target.point.x) || !Number.isFinite(target.point.y) || !insideRect(target.point, current.region) ||
        target.point.x < 0 || target.point.y < 0 || target.point.x >= current.viewport.width || target.point.y >= current.viewport.height)
        throw new Error('TARGET_UNAVAILABLE: normal hover page or control geometry changed.');
      await this.#send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.point.x, y: target.point.y }, signal);
      assertBinding();
    });
  }

  async replaceText(value: string, signal: AbortSignal, expectedFrame: VisualFrame): Promise<void> {
    await this.#attach(signal);
    await this.#withFocus(async () => {
      await this.#validateFrame(expectedFrame, signal);
      await this.#dispatchNative("keyboard", [
        { method: "Input.dispatchKeyEvent", params: { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 } },
        { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 } },
      ], signal);
      await this.#dispatchNative("keyboard", [
        { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 } },
        { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 } },
      ], signal, "");
      for (const char of value) await this.#dispatchNative("keyboard", [
        { method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: char, text: char } },
        { method: "Input.dispatchKeyEvent", params: { type: "keyUp", key: char } },
      ], signal, char);
      }, signal);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#streaming = false;
    if (this.#listening) { chrome.debugger.onEvent.removeListener(this.#frameListener); this.#listening = false; }
    const release = serializedConnection(this.tabId, async () => {
      if (!this.#attached) return;
      this.#attached = false;
      // The outer wait is bounded, but the lease stays held until browser RPCs
      // finish, including late replies. New sessions on other tabs are independent.
      await chrome.debugger.sendCommand({ tabId: this.tabId }, "Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
      await chrome.debugger.detach({ tabId: this.tabId }).catch(() => {});
    });
    this.#closing = bounded(release, new AbortController().signal, "visual disconnect").catch(() => {});
    return this.#closing;
  }
}
