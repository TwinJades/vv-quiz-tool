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
import type { LocalStructure, SeparationRoles, SeparationSnapshot } from "../web/separation-trial";

async function rawSendToTab<T>(tabId: number, frameId: number, request: ContentRequest): Promise<T> {
  const response = (await chrome.tabs.sendMessage(tabId, request, { frameId })) as ContentResponse | undefined;
  if (!response) throw new Error("The page did not respond to VV.");
  if (!response.ok) throw new Error(response.error);
  return response.result as T;
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

  constructor(
    readonly tabId: number,
    readonly observationInputMode: ObservationInputMode = "structured",
    private readonly calibrateSeparation?: (snapshot: SeparationSnapshot) => Promise<SeparationRoles>,
  ) {}

  capabilities(): PlatformCapabilities {
    return {
      question_types: ["single_choice", "multiple_choice", "fill_blank"],
      multi_question_page: false,
      text_input: true,
      image_input: true,
      semantic_targeting: true,
      coordinate_targeting: false,
      submit: true,
      advance: true,
      grading_feedback: true,
      timer_observation: true,
    };
  }

  async waitUntilReady(_signal: AbortSignal): Promise<ReadinessResult> {
    this.#frameIds = await ensureContentInjected(this.tabId);
    if (this.#frameIds.includes(0)) {
      try {
        const mainFrame = await rawSendToTab<ReadinessResult>(this.tabId, 0, { type: "VV_WAIT_READY" });
        if (mainFrame.ready) {
          this.#activeFrameId = 0;
          return mainFrame;
        }
      } catch {
        // Fall through to the remaining frames when the main frame is unavailable.
      }
    }
    const results = await Promise.all(
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
    const ready = results.find((item) => item.result.ready);
    if (ready) {
      this.#activeFrameId = ready.frameId;
      return ready.result;
    }
    return results[0]?.result ?? { ready: false, reason: "question_not_found" };
  }

  async observeSession(sessionId: string, _signal: AbortSignal): Promise<PlatformObservation> {
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
    let observation = await this.#sendWithNavigationRecovery<PlatformObservation>({
      type: "VV_OBSERVE",
      session_id: sessionId,
      mode,
    });
    if (this.observationInputMode === "semantic_snapshot" && this.#snapshotOrigin && observation.surface_origin !== this.#snapshotOrigin && mode === "structured") {
      observation = await this.#sendWithNavigationRecovery<PlatformObservation>({
        type: "VV_OBSERVE", session_id: sessionId, mode: "semantic_snapshot",
      });
    }
    if (!reused && this.calibrateSeparation && this.observationInputMode !== "structured") {
      const candidate = await this.#sendWithNavigationRecovery<{ snapshot: SeparationSnapshot; suggested: boolean }>({
        type: "VV_CAPTURE_SEPARATION",
      });
      if (candidate.suggested && candidate.snapshot.candidates.length > 0) {
        const roles = await this.calibrateSeparation(candidate.snapshot);
        const structure = await this.#sendWithNavigationRecovery<LocalStructure | null>({
          type: "VV_APPLY_SEPARATION",
          roles,
        });
        if (!structure) throw new Error("separation_uncertain: Model roles did not pass local DOM validation.");
        this.#separationStructure = structure;
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
    this.#contextMedia.clear();
    if (this.observationInputMode !== "visual_snapshot" || !observation.page_context) return observation;

    const tab = await chrome.tabs.get(this.tabId);
    if (!tab.active || tab.windowId === undefined) return observation;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const comma = dataUrl.indexOf(",");
    const binary = atob(dataUrl.slice(comma + 1));
    const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (data.length < 24) return observation;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
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
    return rawSendToTab<ActionResult[]>(this.tabId, this.#activeFrameId, { type: "VV_EXECUTE", plan, locator_map: locatorMap }).catch(async (error: unknown) => {
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
      return plan.actions.map((action) => ({
        action_id: action.action_id,
        status: "unknown" as const,
        message: "The page navigated while the action result was being observed.",
      }));
    });
  }

  readState(_signal: AbortSignal): Promise<PlatformState> {
    return this.#sendWithNavigationRecovery({ type: "VV_READ_STATE" });
  }

  async resolveMedia(handles: string[], signal: AbortSignal): Promise<RuntimeMediaPayload[]> {
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
      const response = await fetch(source.source_url, { signal });
      if (!response.ok) throw new Error(`Unable to read question image: HTTP ${response.status}.`);
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
      if (!this.#frameIds.includes(this.#activeFrameId)) {
        const readiness = await this.waitUntilReady(new AbortController().signal);
        if (!readiness.ready) throw error;
      }
      return rawSendToTab<T>(this.tabId, this.#activeFrameId, request);
    }
  }
}
