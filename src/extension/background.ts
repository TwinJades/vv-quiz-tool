import { ModelCallBudget, QuizOrchestrator } from "../core";
import type { SessionRuntimeSnapshot } from "../core";
import { ProviderManager } from "../provider/provider-manager";
import { VercelAiSolverProvider } from "../provider/solver-provider";
import { WebVerifier } from "../web/verifier";
import type { ArmSessionStartRequest, ExtensionRequest, StartSessionRequest } from "./messages";
import { ChromeLocalStore } from "./storage";
import { ensureContentInjected, TabPlatformProxy } from "./tab-platform";

interface ManagedSession {
  orchestrator: QuizOrchestrator;
  snapshot: SessionRuntimeSnapshot;
  lastNotifiedState?: string;
}

const sessions = new Map<number, ManagedSession>();
const startupFailures = new Map<number, SessionRuntimeSnapshot>();
const pendingCommits = new Map<number, Promise<SessionRuntimeSnapshot>>();
const PENDING_START_PREFIX = "vv-pending-start:";
const SESSION_SNAPSHOT_PREFIX = "vv-session-snapshot:";
const PENDING_START_LIFETIME_MS = 2 * 60 * 1000;

interface PendingStart {
  start_request: StartSessionRequest;
  required_origins: string[];
  expires_at: number;
}
const NOTIFICATION_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const store = new ChromeLocalStore();
const providerManager = new ProviderManager(store, (profileId) =>
  [...sessions.values()].some(
    ({ snapshot }) =>
      snapshot.provider_profile_id === profileId &&
      !["COMPLETE", "CANCELLED", "FAILED"].includes(snapshot.state),
  ),
);

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected extension error.";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function pendingStartKey(tabId: number): string {
  return `${PENDING_START_PREFIX}${tabId}`;
}

function sessionSnapshotKey(tabId: number): string {
  return `${SESSION_SNAPSHOT_PREFIX}${tabId}`;
}

async function saveSessionSnapshot(tabId: number, snapshot: SessionRuntimeSnapshot): Promise<void> {
  await chrome.storage.session.set({ [sessionSnapshotKey(tabId)]: snapshot });
}

async function loadSessionSnapshot(tabId: number): Promise<SessionRuntimeSnapshot | undefined> {
  const key = sessionSnapshotKey(tabId);
  const result = await chrome.storage.session.get(key);
  return result[key] as SessionRuntimeSnapshot | undefined;
}

async function removeSessionSnapshot(tabId: number): Promise<void> {
  await chrome.storage.session.remove(sessionSnapshotKey(tabId));
}

async function visibleSessionSnapshot(tabId: number): Promise<SessionRuntimeSnapshot | null> {
  const live = sessions.get(tabId)?.snapshot ?? startupFailures.get(tabId);
  if (live) return live;
  const stored = await loadSessionSnapshot(tabId);
  if (!stored) return null;
  if (["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(stored.state)) return stored;
  const recovered: SessionRuntimeSnapshot = {
    ...stored,
    state: "PAUSED",
    notice: "扩展后台曾被浏览器回收；请清除本次状态后重新启动。",
  };
  await saveSessionSnapshot(tabId, recovered);
  return recovered;
}

async function savePendingStart(request: ArmSessionStartRequest): Promise<void> {
  const pending: PendingStart = {
    start_request: request.start_request,
    required_origins: request.required_origins,
    expires_at: Date.now() + PENDING_START_LIFETIME_MS,
  };
  startupFailures.delete(request.start_request.tab_id);
  await removeSessionSnapshot(request.start_request.tab_id);
  await chrome.storage.session.set({ [pendingStartKey(request.start_request.tab_id)]: pending });
}

async function loadPendingStart(tabId: number): Promise<PendingStart | undefined> {
  const key = pendingStartKey(tabId);
  const result = await chrome.storage.session.get(key);
  return result[key] as PendingStart | undefined;
}

async function removePendingStart(tabId: number): Promise<void> {
  await chrome.storage.session.remove(pendingStartKey(tabId));
}

function startupFailure(request: StartSessionRequest, error: unknown): SessionRuntimeSnapshot {
  const message = publicError(error);
  const sessionId = `startup-${request.tab_id}-${Date.now()}`;
  return {
    session_id: sessionId,
    state: "FAILED",
    strategy: request.strategy,
    observation_input_mode: request.observation_input_mode,
    provider_profile_id: request.provider_profile_id,
    model_id: request.model_id,
    model_calls: { used: 0, limit: request.model_call_limit },
    progress: { total: 0, answered: 0, guessed: 0, retried: 0, skipped: 0, failed: 1 },
    notice: message,
    summary: {
      session_id: sessionId,
      status: "failed",
      total: 0,
      answered: 0,
      guessed: 0,
      retried: 0,
      skipped: 0,
      failed: 1,
      model_calls: 0,
      visible_score: null,
      stop_reason: message,
    },
  };
}

async function updateBadge(tabId: number, snapshot: SessionRuntimeSnapshot): Promise<void> {
  const badge =
    snapshot.state === "COMPLETE"
      ? "✓"
      : snapshot.state === "PAUSED"
        ? "Ⅱ"
        : snapshot.state === "FAILED"
          ? "!"
          : snapshot.state === "CANCELLED"
            ? ""
            : "…";
  await chrome.action.setBadgeText({ tabId, text: badge });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: snapshot.state === "FAILED" ? "#b42318" : snapshot.state === "PAUSED" ? "#b54708" : "#176b52",
  });
}

async function notifyAttention(tabId: number, session: ManagedSession): Promise<void> {
  const { snapshot } = session;
  if (!["PAUSED", "FAILED"].includes(snapshot.state) || session.lastNotifiedState === snapshot.state) return;
  session.lastNotifiedState = snapshot.state;
  await chrome.notifications.create(`vv-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: snapshot.state === "FAILED" ? "VV session failed" : "VV session paused",
    message: snapshot.notice ?? "Open VV to review the session.",
  });
}

async function startSession(request: StartSessionRequest): Promise<SessionRuntimeSnapshot> {
  const existing = sessions.get(request.tab_id);
  if (existing && !["COMPLETE", "CANCELLED", "FAILED"].includes(existing.snapshot.state)) {
    throw new Error("This tab already has an active VV session.");
  }
  const profile = await providerManager.get(request.provider_profile_id);
  if (!profile) throw new Error("The selected Provider profile no longer exists.");
  if (!profile.model_catalog.models.includes(request.model_id)) {
    throw new Error("The selected model is not configured in this Provider profile.");
  }
  if (
    request.observation_input_mode === "visual_snapshot" &&
    (!profile.image_upload_authorized || !profile.capabilities.image_input)
  ) {
    throw new Error("截图模式需要当前 Provider 已授权并支持图片输入。");
  }
  await ensureContentInjected(request.tab_id);

  const budget = new ModelCallBudget(request.model_call_limit);
  const solver = new VercelAiSolverProvider(
    profile,
    request.model_id,
    await providerManager.getApiKey(profile),
    budget,
  );
  const platform = new TabPlatformProxy(
    request.tab_id,
    request.observation_input_mode,
    (snapshot) => solver.calibrateSeparation(snapshot),
  );
  const sessionId = crypto.randomUUID();
  let managed: ManagedSession;
  const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), {
    session_id: sessionId,
    strategy: request.strategy,
    observation_input_mode: request.observation_input_mode,
    provider_profile_id: profile.provider_profile_id,
    model_id: request.model_id,
    model_call_limit: request.model_call_limit,
    model_call_budget: budget,
    image_upload_authorized: profile.image_upload_authorized,
    on_update: (snapshot) => {
      managed.snapshot = snapshot;
      void saveSessionSnapshot(request.tab_id, snapshot);
      void updateBadge(request.tab_id, snapshot);
      void notifyAttention(request.tab_id, managed);
    },
  });
  managed = { orchestrator, snapshot: orchestrator.snapshot() };
  sessions.set(request.tab_id, managed);
  startupFailures.delete(request.tab_id);
  await saveSessionSnapshot(request.tab_id, managed.snapshot);
  void orchestrator.run();
  return managed.snapshot;
}

function commitPendingStart(tabId: number): Promise<SessionRuntimeSnapshot> {
  const current = pendingCommits.get(tabId);
  if (current) return current;
  const commit = (async () => {
    const pending = await loadPendingStart(tabId);
    if (!pending) {
      const currentSession = await visibleSessionSnapshot(tabId);
      if (currentSession) return currentSession;
      throw new Error("No pending VV start request exists for this tab.");
    }
    if (pending.expires_at < Date.now()) {
      await removePendingStart(tabId);
      throw new Error("The VV start request expired before website permission was granted.");
    }
    const granted = await chrome.permissions.contains({ origins: pending.required_origins });
    if (!granted) throw new Error("Website permission has not been granted yet.");
    await removePendingStart(tabId);
    try {
      return await startSession(pending.start_request);
    } catch (error) {
      const failure = startupFailure(pending.start_request, error);
      startupFailures.set(tabId, failure);
      await saveSessionSnapshot(tabId, failure);
      await updateBadge(tabId, failure);
      throw error;
    }
  })().finally(() => pendingCommits.delete(tabId));
  pendingCommits.set(tabId, commit);
  return commit;
}

async function resumeAuthorizedPendingStarts(): Promise<void> {
  const stored = await chrome.storage.session.get(null);
  const tabIds = Object.keys(stored)
    .filter((key) => key.startsWith(PENDING_START_PREFIX))
    .map((key) => Number(key.slice(PENDING_START_PREFIX.length)))
    .filter(Number.isInteger);
  await Promise.allSettled(tabIds.map((tabId) => commitPendingStart(tabId)));
}

async function handleRequest(
  request: ExtensionRequest,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  if (request.type === "VV_DELETE_PROVIDER") {
    await providerManager.delete(request.provider_profile_id);
    return { deleted: true };
  }
  if (request.type === "VV_ARM_SESSION_START") {
    await savePendingStart(request);
    return { armed: true };
  }
  if (request.type === "VV_COMMIT_SESSION_START") return commitPendingStart(request.tab_id);
  if (request.type === "VV_CANCEL_SESSION_START") {
    await removePendingStart(request.tab_id);
    return { cancelled: true };
  }
  if (request.type === "VV_START_SESSION") return startSession(request);

  const session = sessions.get(request.tab_id);
  if (request.type === "VV_GET_SESSION") return visibleSessionSnapshot(request.tab_id);
  if (request.type === "VV_CLEAR_SESSION" && !session) {
    startupFailures.delete(request.tab_id);
    await removePendingStart(request.tab_id);
    await removeSessionSnapshot(request.tab_id);
    await chrome.action.setBadgeText({ tabId: request.tab_id, text: "" });
    return null;
  }
  if (!session) throw new Error("No VV session exists for this tab.");
  if (request.type === "VV_PAUSE_SESSION") session.orchestrator.pause();
  if (request.type === "VV_RESUME_SESSION") void session.orchestrator.resume();
  if (request.type === "VV_SWITCH_STRATEGY") session.orchestrator.switchStrategy(request.strategy);
  if (request.type === "VV_STOP_SESSION") session.orchestrator.stop();
  if (request.type === "VV_CLEAR_SESSION") {
    if (!["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(session.snapshot.state)) {
      throw new Error("Stop the active session before clearing it.");
    }
    sessions.delete(request.tab_id);
    await removeSessionSnapshot(request.tab_id);
    await chrome.action.setBadgeText({ tabId: request.tab_id, text: "" });
    return null;
  }
  return session.orchestrator.snapshot();
}

chrome.runtime.onMessage.addListener((request: ExtensionRequest, sender, sendResponse) => {
  void handleRequest(request, sender).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: publicError(error) }),
  );
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "vv-control") return;
  let tabId: number | undefined;
  port.onMessage.addListener((message: { tab_id?: number }) => {
    if (typeof message.tab_id === "number") tabId = message.tab_id;
  });
  port.onDisconnect.addListener(() => {
    if (tabId === undefined) return;
    const session = sessions.get(tabId);
    if (session?.snapshot.strategy === "supervised" && !["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(session.snapshot.state)) {
      session.orchestrator.pause("The supervised control panel was closed.");
    }
  });
});

chrome.permissions.onAdded.addListener(() => {
  void resumeAuthorizedPendingStarts();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = sessions.get(tabId);
  session?.orchestrator.stop("The target tab was closed.");
  sessions.delete(tabId);
  startupFailures.delete(tabId);
  void removePendingStart(tabId);
  void removeSessionSnapshot(tabId);
});

void resumeAuthorizedPendingStarts();
