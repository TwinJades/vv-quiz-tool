import { ModelCallBudget, QuizOrchestrator, SessionQueue } from "../core";
import type { SessionRuntimeSnapshot } from "../core";
import { ProviderManager } from "../provider/provider-manager";
import { VercelAiSolverProvider } from "../provider/solver-provider";
import { supportsNativeSearch } from "../provider/provider-capabilities";
import { WebVerifier } from "../web/verifier";
import type { ArmSessionStartRequest, ExtensionRequest, StartSessionRequest, TaskPanelSnapshot } from "./messages";
import { ChromeLocalStore } from "./storage";
import { ensureContentInjected, TabPlatformProxy } from "./tab-platform";
import { requireCurrentWebsite, websiteIsAuthorized } from "./website-access";
import { SessionAttentionNotifications } from "./attention-notifications";
import { CourseTabPlatform, createCourseRun } from './course-platform';
import type { CourseOrchestrator } from '../core/course';
import type { CourseInspectionBundle } from '../web/course-inspection';
import {createKnowledgeRun,KnowledgeTabPlatform,previewKnowledge} from './knowledge-practice-platform';
import type {KnowledgePracticeOrchestrator} from '../core/knowledge-practice';

interface ManagedSession {
  orchestrator: QuizOrchestrator | CourseOrchestrator | KnowledgePracticeOrchestrator;
  platform: TabPlatformProxy | CourseTabPlatform | KnowledgeTabPlatform;
  snapshot: SessionRuntimeSnapshot;
  attention: SessionAttentionNotifications;
}

const sessions = new Map<number, ManagedSession>();
const startupFailures = new Map<number, SessionRuntimeSnapshot>();
const pendingCommits = new Map<number, Promise<SessionRuntimeSnapshot>>();
const startingTabs = new Set<number>();
const controls = new Map<chrome.runtime.Port, number | "all">();
const latestMainNavigation = new Map<number, string>();
const queue = new SessionQueue((tabId, error) => {
  sessions.get(tabId)?.orchestrator.pause(publicError(error));
});
const queueReady = chrome.storage.local.get("vv-concurrency").then(data => {
  const limit = data["vv-concurrency"];
  if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 10) queue.setConcurrency(limit);
});
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
    notice: stored.practice?.checkpoint&&!stored.practice.checkpoint.child_active?'扩展后台曾被浏览器回收；可从知识点安全断点继续，先重新核对页面。':"扩展后台曾被浏览器回收；请核对已保存作答和提交结果后再重新启动。",
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
  const notice = session.attention.next(session.snapshot);
  if (!notice) return;
  await chrome.notifications.create(`vv-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    ...notice,
  });
}

async function startSession(request: StartSessionRequest): Promise<SessionRuntimeSnapshot> {
  await queueReady;
  const existing = sessions.get(request.tab_id);
  if (existing && !["COMPLETE", "CANCELLED", "FAILED"].includes(existing.snapshot.state)) {
    throw new Error("This tab already has an active VV session.");
  }
  const profile = await providerManager.get(request.provider_profile_id);
  if (!profile) throw new Error("The selected Provider profile no longer exists.");
  if (!profile.model_catalog.models.includes(request.model_id)) {
    throw new Error("The selected model is not configured in this Provider profile.");
  }
  if (request.allow_native_search === true && !supportsNativeSearch(profile, request.model_id)) {
    throw new Error("当前接口或模型未明确支持原生网页搜索，请关闭本场搜索或选择已确认支持的模型。");
  }
  if (
    !request.course && !request.practice_course && request.observation_input_mode === "visual_snapshot" &&
    (!profile.image_upload_authorized || !profile.capabilities.image_input)
  ) {
    throw new Error("截图模式需要当前 Provider 已授权并支持图片输入。");
  }
  await requireCurrentWebsite(request.tab_id);
  await ensureContentInjected(request.tab_id);

  const budget = new ModelCallBudget(request.model_call_limit);
  if(request.practice_course){
    if(request.course)throw new Error('请分别选择视频课程或知识点练习范围。');
    const catalog=await previewKnowledge(request.tab_id),expected=request.practice_course.catalog;
    if(catalog.course_id!==expected.course_id||catalog.context_id!==expected.context_id||catalog.revision!==expected.revision)throw new Error('知识点预览已改变，请重新读取并选择范围。');
    let managed:ManagedSession;
    const {orchestrator,platform}=createKnowledgeRun(request.tab_id,profile,await providerManager.getApiKey(profile),budget,
      {session_id:crypto.randomUUID(),catalog,scope:request.practice_course.scope,strategy:request.strategy,on_update:snapshot=>{
        managed.snapshot=snapshot;if(sessions.get(request.tab_id)!==managed)return;
        void saveSessionSnapshot(request.tab_id,snapshot);void updateBadge(request.tab_id,snapshot);void notifyAttention(request.tab_id,managed).catch(()=>{});
        if(['PAUSED','COMPLETE','FAILED','CANCELLED'].includes(snapshot.state))void platform.disableInteraction().catch(()=>{});
      }});
    managed={orchestrator,platform,attention:new SessionAttentionNotifications(),snapshot:{...orchestrator.snapshot(),state:'QUEUED',notice:'等待知识点练习运行名额。'}};
    sessions.set(request.tab_id,managed);startupFailures.delete(request.tab_id);await saveSessionSnapshot(request.tab_id,managed.snapshot);
    try{await platform.enableInteraction();}catch(e){orchestrator.stop('知识点人工操作保护安装失败。');sessions.delete(request.tab_id);throw e;}
    queue.enqueue(request.tab_id,()=>orchestrator.run());return managed.snapshot;
  }
  if (request.course) {
    const previewPlatform = new CourseTabPlatform(request.tab_id,crypto.randomUUID(),request.course.course_id);
    const catalog = await previewPlatform.preview(new AbortController().signal);
    if(catalog.course_id!==request.course.course_id||catalog.platform!==request.course.platform||catalog.revision!==request.course.revision)throw new Error('课程预览已改变，请重新读取并选择范围。');
    let managed: ManagedSession;
    const {orchestrator,platform} = await createCourseRun(request.tab_id,profile,await providerManager.getApiKey(profile),budget,{
      session_id:crypto.randomUUID(),catalog,scope:request.course.scope,strategy:request.strategy,provider_profile_id:profile.provider_profile_id,
      on_update:snapshot=>{
        managed.snapshot=snapshot;if(sessions.get(request.tab_id)!==managed)return;
        void saveSessionSnapshot(request.tab_id,snapshot);void updateBadge(request.tab_id,snapshot);
        void notifyAttention(request.tab_id,managed).catch(()=>{});
        if(['PAUSED','COMPLETE','FAILED','CANCELLED'].includes(snapshot.state))void platform.disableInteraction().catch(()=>{});
      },
    });
    managed={orchestrator,platform,attention:new SessionAttentionNotifications(),snapshot:{...orchestrator.snapshot(),state:'QUEUED',notice:'等待课程运行名额。'}};
    sessions.set(request.tab_id,managed);startupFailures.delete(request.tab_id);
    await saveSessionSnapshot(request.tab_id,managed.snapshot);
    try{await platform.enableInteraction();}catch(error){orchestrator.stop('课程人工操作保护安装失败。');sessions.delete(request.tab_id);throw error;}
    queue.enqueue(request.tab_id,()=>orchestrator.run());return managed.snapshot;
  }
  const solver = new VercelAiSolverProvider(
    profile,
    request.model_id,
    await providerManager.getApiKey(profile),
    budget,
  );
  const platform = new TabPlatformProxy(
    request.tab_id,
    request.observation_input_mode,
    (snapshot, signal) => solver.calibrateSeparation(snapshot, signal),
    async (capture, signal, context) => {
      await requireCurrentWebsite(request.tab_id);
      signal.throwIfAborted();
      return solver.recognizeVisual(capture, signal, context);
    },
    (snapshot, signal) => solver.recognizeInitialSemantic(snapshot, signal),
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
    allow_native_search: request.allow_native_search === true,
    on_update: (snapshot) => {
      managed.snapshot = snapshot;
      if (sessions.get(request.tab_id) !== managed) return;
      void saveSessionSnapshot(request.tab_id, snapshot);
      void updateBadge(request.tab_id, snapshot);
      void notifyAttention(request.tab_id, managed).catch(() => { /* Notification delivery failure must not interrupt controlled execution. */ });
      if (["PAUSED", "COMPLETE", "FAILED", "CANCELLED"].includes(snapshot.state)) {
        void platform.disableInteraction().catch(() => { /* Navigated/closed pages remain locally blocked. */ });
      }
    },
  });
  managed = { orchestrator, platform, attention: new SessionAttentionNotifications(), snapshot: { ...orchestrator.snapshot(), state: "QUEUED", notice: "等待并行运行名额。" } };
  sessions.set(request.tab_id, managed);
  startupFailures.delete(request.tab_id);
  await saveSessionSnapshot(request.tab_id, managed.snapshot);
  try { await platform.enableInteraction(sessionId); }
  catch (error) { orchestrator.stop("Manual interaction protection could not be installed."); sessions.delete(request.tab_id); throw error; }
  if (managed.snapshot.state === "PAUSED") return managed.snapshot;
  queue.enqueue(request.tab_id, () => orchestrator.run());
  return managed.snapshot;
}

async function scheduleStart(request: StartSessionRequest): Promise<SessionRuntimeSnapshot> {
  if (startingTabs.has(request.tab_id) || queue.has(request.tab_id)) throw new Error("This tab already has a starting, running or queued task.");
  startingTabs.add(request.tab_id);
  try { return await startSession(request); }
  finally { startingTabs.delete(request.tab_id); }
}

async function taskPanelSnapshot(): Promise<TaskPanelSnapshot> {
  await queueReady;
  const stored = await chrome.storage.session.get(null);
  const ids = new Set([...sessions.keys(), ...startupFailures.keys(), ...Object.keys(stored).filter(key => key.startsWith(SESSION_SNAPSHOT_PREFIX)).map(key => Number(key.slice(SESSION_SNAPSHOT_PREFIX.length)))]);
  const tasks: TaskPanelSnapshot["tasks"] = [];
  for (const tabId of ids) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const snapshot = await visibleSessionSnapshot(tabId);
      if (snapshot) tasks.push({ tab_id: tabId, title: tab.title || `标签 ${tabId}`, url: tab.url ?? null, provider_name: (await providerManager.get(snapshot.provider_profile_id))?.display_name || "Provider 已移除", snapshot, resumable: sessions.has(tabId)||snapshot.state==='PAUSED'&&snapshot.practice?.checkpoint?.child_active===false });
    } catch { /* A closed target is not a task. */ }
  }
  return { ...queue.snapshot(), tasks };
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
      return await scheduleStart(pending.start_request);
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
  if (sender.id !== chrome.runtime.id) throw new Error("Only this extension may control VV tasks.");
  if (request.type === "VV_USER_INTERACTION") {
    const tabId = sender.tab?.id;
    const session = tabId === undefined ? undefined : sessions.get(tabId);
    if (!session || !session.platform.interactionMatches(request.session_id, request.epoch)) return { ignored: true };
    queue.cancelQueued(tabId!);
    session.orchestrator.pause("检测到你在测验页面点击或输入，已暂停。继续后会重新读取当前题目。");
    return { paused: true };
  }
  if (sender.url && !sender.url.startsWith(chrome.runtime.getURL(""))) {
    throw new Error("Website content may only report manual interaction in its own session.");
  }
  if (request.type === "VV_GET_TASKS") return taskPanelSnapshot();
  if (request.type === 'VV_PREVIEW_COURSE') {
    const platform = new CourseTabPlatform(request.tab_id,crypto.randomUUID(),'preview');
    return platform.preview(new AbortController().signal);
  }
  if(request.type==='VV_INSPECT_COURSE'){
    await requireCurrentWebsite(request.tab_id);
    const available=await chrome.webNavigation.getAllFrames({tabId:request.tab_id});
    if(!available?.length)throw new Error('没有可读取的页面，请回到课程页后重试。');
    const frames=await Promise.all(available.map(async (frame):Promise<CourseInspectionBundle['frames'][number]>=>{
      const unavailable=(error:NonNullable<CourseInspectionBundle['frames'][number]['error']>)=>({frame_id:frame.frameId,error});
      try{
        if(!await websiteIsAuthorized(frame.url))return unavailable('not_authorized');
        const target={tabId:request.tab_id,...(frame.documentId?{documentIds:[frame.documentId]}:{frameIds:[frame.frameId]})};
        await chrome.scripting.executeScript({target,files:['content.js']});
        await requireCurrentWebsite(request.tab_id);
        const before=await chrome.webNavigation.getFrame({tabId:request.tab_id,frameId:frame.frameId});
        if(!before||before.url!==frame.url||before.documentId!==frame.documentId)return unavailable('page_changed');
        if(!await websiteIsAuthorized(before.url))return unavailable('not_authorized');
        const response=await chrome.tabs.sendMessage(request.tab_id,{type:'VV_INSPECT_COURSE_PAGE'},
          frame.documentId?{documentId:frame.documentId}:{frameId:frame.frameId});
        const after=await chrome.webNavigation.getFrame({tabId:request.tab_id,frameId:frame.frameId});
        if(!after||after.url!==before.url||after.documentId!==before.documentId)return unavailable('page_changed');
        if(!await websiteIsAuthorized(after.url))return unavailable('not_authorized');
        if(!response?.ok)return unavailable('read_failed');
        return {frame_id:frame.frameId,inspection:response.result};
      }catch{return unavailable('read_failed');}
    }));
    await requireCurrentWebsite(request.tab_id);
    if(!frames.some(frame=>frame.inspection))throw new Error('结构读取失败，请检查页面是否加载完成及网站/frame权限。');
    const bundle:CourseInspectionBundle={schema_version:1,captured_at:new Date().toISOString(),complete:frames.every(frame=>frame.inspection!==undefined),frames};
    return bundle;
  }
  if (request.type === "VV_SET_CONCURRENCY") {
    await queueReady;
    queue.setConcurrency(request.limit);
    await chrome.storage.local.set({ "vv-concurrency": request.limit });
    return taskPanelSnapshot();
  }
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
  if (request.type === "VV_START_SESSION") return scheduleStart(request);
  if(request.type==='VV_PREVIEW_PRACTICES')return previewKnowledge(request.tab_id);

  let session = sessions.get(request.tab_id);
  if (request.type === "VV_GET_SESSION") return visibleSessionSnapshot(request.tab_id);
  if (request.type === "VV_CLEAR_SESSION" && !session) {
    startupFailures.delete(request.tab_id);
    await removePendingStart(request.tab_id);
    await removeSessionSnapshot(request.tab_id);
    await chrome.action.setBadgeText({ tabId: request.tab_id, text: "" });
    return null;
  }
  if(request.type==='VV_RESUME_SESSION'&&!session){
    const snapshot=await visibleSessionSnapshot(request.tab_id),practice=snapshot?.practice,checkpoint=practice?.checkpoint;
    if(!snapshot||snapshot.state!=='PAUSED'||!checkpoint||checkpoint.child_active)throw new Error('后台恢复缺少安全断点；请先核对已有作答/提交，禁止盲目重做。');
    await requireCurrentWebsite(request.tab_id);
    const profile=await providerManager.get(snapshot.provider_profile_id);if(!profile)throw new Error('Provider已移除，不能恢复。');
    const budget=new ModelCallBudget(snapshot.model_calls.limit);if(snapshot.model_calls.used)budget.reserve(snapshot.model_calls.used).settle(snapshot.model_calls.used);
    let managed:ManagedSession;
    const {orchestrator,platform}=createKnowledgeRun(request.tab_id,profile,await providerManager.getApiKey(profile),budget,
      {session_id:snapshot.session_id,catalog:checkpoint.catalog,scope:practice.scope,strategy:snapshot.strategy,restore:snapshot,on_update:next=>{
        managed.snapshot=next;if(sessions.get(request.tab_id)!==managed)return;
        void saveSessionSnapshot(request.tab_id,next);void updateBadge(request.tab_id,next);void notifyAttention(request.tab_id,managed).catch(()=>{});
        if(['PAUSED','COMPLETE','FAILED','CANCELLED'].includes(next.state))void platform.disableInteraction().catch(()=>{});
      }});
    managed={orchestrator,platform,attention:new SessionAttentionNotifications(),snapshot:orchestrator.snapshot()};sessions.set(request.tab_id,managed);session=managed;
  }
  if (!session) throw new Error("No VV session exists for this tab.");
  if (request.type === "VV_PAUSE_SESSION") { queue.cancelQueued(request.tab_id); session.orchestrator.pause(); }
  if (request.type === "VV_RESUME_SESSION") {
    if (session.snapshot.state !== "PAUSED") throw new Error("Only paused sessions can resume.");
    if (queue.has(request.tab_id)) throw new Error("会话正在完成暂停，请稍后继续。");
    await requireCurrentWebsite(request.tab_id, latestMainNavigation.get(request.tab_id));
    await session.platform.enableInteraction(session.snapshot.session_id);
    if (session.snapshot.state !== "PAUSED") throw new Error("Session changed while resuming.");
    session.snapshot = { ...session.snapshot, state: "QUEUED", notice: "等待并行运行名额。" };
    await saveSessionSnapshot(request.tab_id, session.snapshot);
    queue.enqueue(request.tab_id, () => session.orchestrator.resume());
    return session.snapshot;
  }
  if (request.type === "VV_SWITCH_STRATEGY") session.orchestrator.switchStrategy(request.strategy);
  if (request.type === "VV_STOP_SESSION") { queue.cancelQueued(request.tab_id); session.orchestrator.stop(); }
  if (request.type === "VV_CLEAR_SESSION") {
    if (!["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(session.snapshot.state)) {
      throw new Error("Stop the active session before clearing it.");
    }
    queue.cancelQueued(request.tab_id);
    session.orchestrator.stop();
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
  if (!["vv-control", "vv-tasks"].includes(port.name)) return;
  if (port.name === "vv-tasks") controls.set(port, "all");
  port.onMessage.addListener((message: { tab_id?: number }) => {
    if (typeof message.tab_id === "number" && port.name === "vv-control") controls.set(port, message.tab_id);
  });
  port.onDisconnect.addListener(() => {
    const affected = controls.get(port);
    controls.delete(port);
    for (const [tabId, session] of sessions) {
      if (affected !== "all" && affected !== tabId) continue;
      if ([...controls.values()].some(control => control === "all" || control === tabId)) continue;
      if (session.snapshot.strategy === "supervised" && !["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(session.snapshot.state)) {
        queue.cancelQueued(tabId);
        session.orchestrator.pause("The supervised control panel was closed.");
      }
    }
  });
});

chrome.permissions.onAdded.addListener(() => {
  void resumeAuthorizedPendingStarts();
});

async function pauseWithoutWebsitePermission(tabId: number, url: string): Promise<void> {
  const session = sessions.get(tabId);
  if (!session || ["PAUSED", "COMPLETE", "CANCELLED", "FAILED"].includes(session.snapshot.state)) return;
  let authorized = false;
  try { authorized = await websiteIsAuthorized(url); } catch { /* An unavailable permission check cannot authorize a site. */ }
  if (authorized || sessions.get(tabId) !== session) return;
  if (latestMainNavigation.get(tabId) !== url) return;
  if (["PAUSED", "COMPLETE", "CANCELLED", "FAILED"].includes(session.snapshot.state)) return;
  queue.cancelQueued(tabId);
  session.orchestrator.pause("标签页已进入未授权网站，请授予当前网站权限后再继续。");
}

// tabs.onUpdated omits URL for ungranted hosts without the broad tabs permission.
// The already-required webNavigation permission supplies the actual main URL.
function checkMainNavigation(details: { tabId: number; frameId: number; url: string }): void {
  if (details.frameId !== 0 || !sessions.has(details.tabId)) return;
  latestMainNavigation.set(details.tabId, details.url);
  void pauseWithoutWebsitePermission(details.tabId, details.url);
}
chrome.webNavigation.onBeforeNavigate.addListener(checkMainNavigation);
chrome.webNavigation.onCommitted.addListener(checkMainNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(checkMainNavigation);

chrome.permissions.onRemoved.addListener(() => {
  for (const tabId of sessions.keys()) {
    void chrome.webNavigation.getFrame({ tabId, frameId: 0 }).then(frame => {
      if (frame?.url) { latestMainNavigation.set(tabId, frame.url); return pauseWithoutWebsitePermission(tabId, frame.url); }
    }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  latestMainNavigation.delete(tabId);
  queue.cancelQueued(tabId);
  const session = sessions.get(tabId);
  session?.orchestrator.stop("The target tab was closed.");
  sessions.delete(tabId);
  startupFailures.delete(tabId);
  void removePendingStart(tabId);
  void removeSessionSnapshot(tabId);
});

chrome.debugger.onDetach.addListener(source => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  const session = sessions.get(tabId);
  if (session && !["PAUSED", "COMPLETE", "CANCELLED", "FAILED"].includes(session.snapshot.state)) {
    queue.cancelQueued(tabId);
    session.orchestrator.pause("视觉页面控制连接已断开，请检查页面后再继续。");
  }
});

void resumeAuthorizedPendingStarts();
