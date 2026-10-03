import type {
  ActionResult,
  ExecutionPlan,
  LocatorMap,
  ObservationInputMode,
  PlatformCapabilities,
  PlatformObservation,
  PlatformState,
  ReadinessResult,
  RuntimeMediaPayload,
  RuntimePlatform,
} from "../core";
import type { ContentRequest, ContentResponse } from "./messages";
import type { InteractionBinding } from "./interaction-guard";
import { emptyVisualMetrics } from "../core/visual";
import type { VisualCapture, VisualGeometry, VisualReading, VisualRecognitionContext } from "../core/visual";
import { VisualTransport } from "./visual-transport";
import { VisualWebAdapter } from "../web/visual-adapter";
import type { LocalStructure, SeparationRoles, SeparationSnapshot } from "../web/separation-trial";

async function rawSendToTab<T>(tabId: number, frameId: number, request: ContentRequest): Promise<T> {
  const response = (await chrome.tabs.sendMessage(tabId, request, { frameId })) as ContentResponse | undefined;
  if (!response) throw new Error("The page did not respond to VV.");
  if (!response.ok) throw new Error(response.error);
  return response.result as T;
}

async function fetchQuestionImage(url: string, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (signal.aborted || attempt === 2) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }
    if (response.ok) return response;
    if (response.status < 500 || attempt === 2) throw new Error(`Unable to read question image: HTTP ${response.status}.`);
    await new Promise<void>((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error("Unable to read question image.");
}

export async function ensureContentInjected(tabId: number): Promise<number[]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"],
  });
  return [...new Set(results.map((result) => result.frameId))];
}

export class TabPlatformProxy implements RuntimePlatform {
  #activeFrameId = 0;
  #frameIds: number[] = [0];
  #contextMedia = new Map<string, RuntimeMediaPayload>();
  #separationStructure: LocalStructure | null = null;
  #firstSemanticSnapshotSent = false;
  #snapshotOrigin: string | null = null;
  #lastStructureKey: string | null = null;
  #interaction: InteractionBinding | null = null;
  #visual: VisualWebAdapter | null = null;
  #transport: VisualTransport | null = null;
  #visualActive = false;
  #visualClosing: Promise<void> = Promise.resolve();
  #retiredVisualMetrics = emptyVisualMetrics();

  visualMetrics() {
    const total = { ...this.#retiredVisualMetrics };
    const active = this.#visual?.visualMetrics();
    if (active) for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += active[key];
    return total;
  }

  constructor(
    readonly tabId: number,
    readonly observationInputMode: ObservationInputMode = "structured",
    private readonly calibrateSeparation?: (snapshot: SeparationSnapshot, signal: AbortSignal) => Promise<SeparationRoles>,
    private readonly recognizeVisual?: (capture: VisualCapture, signal: AbortSignal, context?: VisualRecognitionContext) => Promise<VisualReading>,
  ) {}

  capabilities(): PlatformCapabilities {
    return {
      question_types: ["single_choice", "multiple_choice", "fill_blank"],
      multi_question_page: true,
      text_input: true,
      image_input: true,
      semantic_targeting: true,
      coordinate_targeting: this.observationInputMode === "visual_snapshot" && Boolean(this.recognizeVisual),
      submit: true,
      advance: true,
      grading_feedback: true,
      timer_observation: true,
    };
  }

  interactionMatches(sessionId: string, epoch: string): boolean {
    return this.#interaction?.enabled === true && this.#interaction.session_id === sessionId && this.#interaction.epoch === epoch;
  }

  async enableInteraction(sessionId: string): Promise<void> {
    await this.#visualClosing;
    this.#interaction = { session_id: sessionId, epoch: crypto.randomUUID(), enabled: true };
    this.#frameIds = await ensureContentInjected(this.tabId);
    await this.#bindInteraction();
  }

  async disableInteraction(): Promise<void> {
    if (!this.#interaction?.enabled) return;
    this.#interaction = { ...this.#interaction, enabled: false };
    await Promise.allSettled([this.#bindInteraction(), this.#closeVisual()]);
  }

  #getTransport(): VisualTransport {
    return this.#transport ??= new VisualTransport(this.tabId,
      async () => {
        if (!this.#interaction?.enabled) throw new Error("USER_INTERACTION: no active visual session.");
        const request: ContentRequest = { type: "VV_VISUAL_GEOMETRY", binding: this.#interaction };
        const frames = [...new Set([0, ...this.#frameIds])];
        const geometries = await Promise.all(frames.map(frameId => rawSendToTab<VisualGeometry>(this.tabId, frameId, request)));
        return geometries[frames.indexOf(0)]!;
      },
      () => this.#interaction,
      async ticket => {
        await Promise.all(this.#frameIds.map(frameId => rawSendToTab(this.tabId, frameId, { type: "VV_ARM_NATIVE_INPUT", ticket })));
      });
  }

  #activateVisual(): VisualWebAdapter {
    if (this.observationInputMode !== "visual_snapshot" || !this.recognizeVisual) throw new Error("VISUAL_UNAVAILABLE: screenshot mode and authorized visual provider are required.");
    this.#visualActive = true;
    return this.#visual ??= new VisualWebAdapter(this.#getTransport(), this.recognizeVisual);
  }

  #closeVisual(): Promise<void> {
    const visual = this.#visual;
    const transport = this.#transport;
    if (visual) this.#retiredVisualMetrics = this.visualMetrics();
    this.#visualActive = false; this.#visual = null; this.#transport = null;
    this.#contextMedia.clear();
    this.#visualClosing = visual ? visual.close() : transport ? transport.close() : Promise.resolve();
    return this.#visualClosing;
  }

  async #bindInteraction(): Promise<void> {
    const binding = this.#interaction;
    if (!binding) return;
    const results = await Promise.allSettled(this.#frameIds.map(frameId => rawSendToTab<boolean>(this.tabId, frameId, {
      type: "VV_SET_INTERACTION", binding,
    })));
    if (binding.enabled && results.some(result => result.status === "rejected")) {
      throw new Error("Unable to install manual interaction protection in every authorized frame.");
    }
  }

  async waitUntilReady(_signal: AbortSignal): Promise<ReadinessResult> {
    _signal.throwIfAborted();
    this.#frameIds = await ensureContentInjected(this.tabId);
    await this.#bindInteraction();
    _signal.throwIfAborted();
    if(this.observationInputMode === "visual_snapshot" && this.recognizeVisual && this.#frameIds.includes(0)) {
      const geometry = await rawSendToTab<VisualGeometry>(this.tabId, 0, { type: "VV_VISUAL_GEOMETRY" });
      if(geometry.blocker) return {ready:false,reason:geometry.blocker};
      if(geometry.canvas_surface) {
        this.#activeFrameId=0;this.#activateVisual();return {ready:true};
      }
    }
    let mainFrameResult: ReadinessResult | null = null;
    const childResults = await Promise.all(
      this.#frameIds.filter((frameId) => frameId !== 0).map(async (frameId) => {
        try {
          return { frameId, result: await rawSendToTab<ReadinessResult>(this.tabId, frameId, { type: "VV_WAIT_READY" }) };
        } catch (error) {
          return {
            frameId,
            result: { ready: false, reason: error instanceof Error ? error.message : "frame_unavailable" },
          };
        }
      }),
    );
    const readyChildren = childResults.filter((item) => item.result.ready);
    if (readyChildren.length === 1) {
      this.#activeFrameId = readyChildren[0]!.frameId;
      return readyChildren[0]!.result;
    }
    if (this.#frameIds.includes(0)) {
      try {
        const mainFrame = await rawSendToTab<ReadinessResult>(this.tabId, 0, { type: "VV_WAIT_READY" });
        mainFrameResult = mainFrame;
        if (mainFrame.ready) {
          this.#activeFrameId = 0;
          return mainFrame;
        }
      } catch {
        // Fall through to the remaining frames when the main frame is unavailable.
      }
    }
    const ready = readyChildren[0];
    if (ready) {
      this.#activeFrameId = ready.frameId;
      return ready.result;
    }
    const hardBlocker = [mainFrameResult, ...childResults.map((item) => item.result)].find((item) =>
      item && !item.ready && item.reason && !["readiness_timeout", "question_not_found"].includes(item.reason));
    if (hardBlocker) return hardBlocker;
    const fallback = mainFrameResult ?? childResults[0]?.result ?? { ready: false, reason: "question_not_found" };
    if (this.observationInputMode === "visual_snapshot" && this.recognizeVisual && ["readiness_timeout", "question_not_found"].includes(fallback.reason ?? "")) {
      this.#activateVisual();
      return { ready: true };
    }
    if (this.observationInputMode === "structured" || !this.calibrateSeparation ||
      !["readiness_timeout", "question_not_found"].includes(fallback.reason ?? "")) return fallback;
    const candidates = await Promise.all(this.#frameIds.map(async (frameId) => {
      try {
        const result = await rawSendToTab<{ snapshot: SeparationSnapshot; suggested: boolean }>(this.tabId, frameId, { type: "VV_CAPTURE_SEPARATION" });
        return result.suggested && result.snapshot.candidates.some((item) => item.kind === "region") ? frameId : null;
      } catch { return null; }
    }));
    const supportedFrames = candidates.filter((frameId): frameId is number => frameId !== null);
    if (supportedFrames.length === 1) {
      this.#activeFrameId = supportedFrames[0]!;
      return { ready: true };
    }
    return fallback;
  }

  async #calibrateCurrentQuestion(candidate: { snapshot: SeparationSnapshot; suggested: boolean }, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!this.calibrateSeparation || !candidate.suggested || candidate.snapshot.candidates.length === 0) {
      throw new Error("separation_uncertain: No validated question region is available.");
    }
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new DOMException("Cancelled.", "AbortError")); });
    signal.addEventListener("abort", abort, { once: true });
    let roles: SeparationRoles;
    try { roles = await Promise.race([this.calibrateSeparation(candidate.snapshot, signal), cancelled]); }
    finally { signal.removeEventListener("abort", abort); }
    signal.throwIfAborted();
    const structure = await this.#sendWithNavigationRecovery<LocalStructure | null>({
      type: "VV_APPLY_SEPARATION",
      roles,
    });
    signal.throwIfAborted();
    if (!structure) throw new Error("separation_uncertain: Model roles did not pass local DOM validation.");
    this.#separationStructure = structure;
  }

  #structureKey(observation: PlatformObservation): string | null {
    const question = observation.questions?.[0]?.question;
    if (!question) return null;
    return JSON.stringify({
      type: question.type,
      options: question.options.length,
      blanks: question.blanks.length,
      controls: (observation.local_control_candidates ?? [])
        .map((item) => item.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim())
        .sort(),
    });
  }

  async observeSession(sessionId: string, _signal: AbortSignal): Promise<PlatformObservation> {
    _signal.throwIfAborted();
    if (this.#visualActive) return this.#activateVisual().observeSession(sessionId, _signal);
    let reused = false;
    const hadStructure = Boolean(this.#separationStructure);
    if (this.#separationStructure) {
      reused = await this.#sendWithNavigationRecovery<boolean>({
        type: "VV_REUSE_SEPARATION",
        structure: this.#separationStructure,
      });
      if (!reused) this.#separationStructure = null;
    }
    const mode: ObservationInputMode = this.observationInputMode === "semantic_snapshot"
      ? (!this.#firstSemanticSnapshotSent || (hadStructure && !reused) ? "semantic_snapshot" : "structured")
      : reused ? "structured" : this.observationInputMode;
    let observation: PlatformObservation;
    let recoveredByCalibration = false;
    try {
      observation = await this.#sendWithNavigationRecovery<PlatformObservation>({
        type: "VV_OBSERVE", session_id: sessionId, mode,
      });
    } catch (error) {
      if (this.observationInputMode === "visual_snapshot" && this.recognizeVisual && /No supported question|observation_missing/i.test(error instanceof Error ? error.message : "")) {
        return this.#activateVisual().observeSession(sessionId, _signal);
      }
      if (this.observationInputMode === "structured" || !this.calibrateSeparation ||
        !/No supported question was found|question_not_found/i.test(error instanceof Error ? error.message : "")) throw error;
      const candidate = await this.#sendWithNavigationRecovery<{ snapshot: SeparationSnapshot; suggested: boolean }>({
        type: "VV_CAPTURE_SEPARATION",
      });
      if (!candidate.suggested || candidate.snapshot.candidates.length === 0) throw error;
      await this.#calibrateCurrentQuestion(candidate, _signal);
      recoveredByCalibration = true;
      observation = await this.#sendWithNavigationRecovery<PlatformObservation>({
        type: "VV_OBSERVE", session_id: sessionId, mode: this.observationInputMode,
      });
    }
    const structureChanged = this.#lastStructureKey !== null && this.#structureKey(observation) !== this.#lastStructureKey;
    if (this.observationInputMode === "semantic_snapshot" && mode === "structured" && !recoveredByCalibration &&
      ((this.#snapshotOrigin && observation.surface_origin !== this.#snapshotOrigin) || structureChanged)) {
      observation = await this.#sendWithNavigationRecovery<PlatformObservation>({
        type: "VV_OBSERVE", session_id: sessionId, mode: "semantic_snapshot",
      });
    }
    if (observation.layout === "sequential" && !reused && !recoveredByCalibration && this.calibrateSeparation && this.observationInputMode !== "structured") {
      const candidate = await this.#sendWithNavigationRecovery<{ snapshot: SeparationSnapshot; suggested: boolean }>({
        type: "VV_CAPTURE_SEPARATION",
      });
      if (candidate.suggested && candidate.snapshot.candidates.length > 0) {
        await this.#calibrateCurrentQuestion(candidate, _signal);
        observation = await this.#sendWithNavigationRecovery<PlatformObservation>({
          type: "VV_OBSERVE",
          session_id: sessionId,
          mode: this.observationInputMode,
        });
      }
    }
    if (this.observationInputMode === "semantic_snapshot" && observation.page_context) {
      this.#firstSemanticSnapshotSent = true;
      this.#snapshotOrigin = observation.surface_origin;
    }
    this.#lastStructureKey = this.#structureKey(observation);
    this.#contextMedia.clear();
    if (this.observationInputMode !== "visual_snapshot" || !observation.page_context) return observation;

    const capture = await this.#getTransport().capture(sessionId, observation.observation_id, _signal);
    const { data } = capture;
    const { width, height } = capture.frame;
    const temporaryHandle = `page_capture_${crypto.randomUUID()}`;
    this.#contextMedia.set(temporaryHandle, { temporary_handle: temporaryHandle, mime_type: "image/png", data });
    observation.page_context.media = [{
      id: `media_${crypto.randomUUID()}`,
      kind: "image",
      purpose: "visible_page_snapshot_for_question_and_control_separation",
      source: "region_capture",
      mime_type: "image/png",
      width,
      height,
      temporary_handle: temporaryHandle,
    }];
    return observation;
  }

  execute(
    plan: ExecutionPlan,
    locatorMap: LocatorMap,
    _signal: AbortSignal,
  ): Promise<ActionResult[]> {
    _signal.throwIfAborted();
    if (this.#visualActive) return this.#activateVisual().execute(plan, locatorMap, _signal);
    return rawSendToTab<ActionResult[]>(this.tabId, this.#activeFrameId, { type: "VV_EXECUTE", plan, locator_map: locatorMap,
      ...(this.#interaction ? { interaction_epoch: this.#interaction.epoch } : {}) }).catch(async (error: unknown) => {
      _signal.throwIfAborted();
      const message = error instanceof Error ? error.message : "";
      if (/reason=observation_missing/.test(message) && plan.actions.every((action) => ["advance", "submit_question", "submit_session"].includes(action.kind))) {
        return plan.actions.map((action) => ({
          action_id: action.action_id,
          status: "unknown" as const,
          message: "The page changed before the control response returned; verify the destination before continuing.",
        }));
      }
      if (!/Receiving end does not exist|Could not establish connection|message port closed/i.test(message)) {
        throw error;
      }
      this.#frameIds = await ensureContentInjected(this.tabId);
      await this.#bindInteraction();
      return plan.actions.map((action) => ({
        action_id: action.action_id,
        status: "unknown" as const,
        message: "The page navigated while the action result was being observed.",
      }));
    });
  }

  readState(_signal: AbortSignal): Promise<PlatformState> {
    _signal.throwIfAborted();
    if (this.#visualActive) return this.#activateVisual().readState(_signal);
    return this.#sendWithNavigationRecovery({ type: "VV_READ_STATE" });
  }

  async readTimer(signal: AbortSignal): Promise<number | null> {
    signal.throwIfAborted();
    // No extra model recognition for polling a Canvas timer.
    if (this.#visualActive) return null;
    const timers = await Promise.all([this.#activeFrameId, ...(this.#activeFrameId ? [0] : [])].map(frameId =>
      rawSendToTab<number | null>(this.tabId, frameId, { type: "VV_READ_TIMER" }).catch(() => null)));
    signal.throwIfAborted();
    const known = timers.filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
    return known.length ? Math.min(...known) : null;
  }

  async resolveMedia(handles: string[], signal: AbortSignal): Promise<RuntimeMediaPayload[]> {
    if (this.#visualActive) return this.#activateVisual().resolveMedia(handles, signal);
    const contextPayloads = handles.flatMap((handle) => {
      const payload = this.#contextMedia.get(handle);
      return payload ? [payload] : [];
    });
    const contentHandles = handles.filter((handle) => !this.#contextMedia.has(handle));
    if (contentHandles.length === 0) return contextPayloads;
    const sources = await this.#sendWithNavigationRecovery<
      Array<{ temporary_handle: string; source_url: string; mime_type: string }>
    >({ type: "VV_RESOLVE_MEDIA", temporary_handles: contentHandles });
    const payloads: RuntimeMediaPayload[] = [...contextPayloads];
    for (const source of sources) {
      const response = await fetchQuestionImage(source.source_url, signal);
      const mimeType = response.headers.get("content-type")?.split(";")[0] || source.mime_type;
      if (!mimeType.startsWith("image/")) throw new Error("Question media is not a supported image.");
      payloads.push({
        temporary_handle: source.temporary_handle,
        mime_type: mimeType,
        data: new Uint8Array(await response.arrayBuffer()),
      });
    }
    return payloads;
  }

  async #sendWithNavigationRecovery<T>(request: ContentRequest): Promise<T> {
    try {
      return await rawSendToTab<T>(this.tabId, this.#activeFrameId, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/Receiving end does not exist|Could not establish connection|message port closed/i.test(message)) {
        throw error;
      }
      this.#frameIds = await ensureContentInjected(this.tabId);
      await this.#bindInteraction();
      if (!this.#frameIds.includes(this.#activeFrameId)) {
        const readiness = await this.waitUntilReady(new AbortController().signal);
        if (!readiness.ready) throw error;
      }
      return rawSendToTab<T>(this.tabId, this.#activeFrameId, request);
    }
  }
}
