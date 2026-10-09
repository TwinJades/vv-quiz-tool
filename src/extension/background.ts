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
import { readUiLanguage } from './ui-language';
import { CourseTabPlatform, createCourseRun } from './course-platform';
import type { CourseOrchestrator } from '../core/course';
import type { CourseInspectionBundle } from '../web/course-inspection';
import {createKnowledgeRun,KnowledgeTabPlatform,previewKnowledge} from './knowledge-practice-platform';
declare const __VV_BUILD_ID__: string;
import type {KnowledgePracticeOrchestrator} from '../core/knowledge-practice';
import {recordTestEvent} from './test-hooks';
import {hasActiveDebuggerTransport} from './visual-transport';
import {COURSE_RECORD_PREFIX,courseResumeUrl,savedCourseMatches,courseCatalogMatchesUrl} from './course-record';
import type {SavedCourseRecord} from './course-record';
import type {CourseCatalog} from '../core/course';

interface ManagedSession {
  budget:ModelCallBudget;
  orchestrator: QuizOrchestrator | CourseOrchestrator | KnowledgePracticeOrchestrator;
  platform: TabPlatformProxy | CourseTabPlatform | KnowledgeTabPlatform;
  snapshot: SessionRuntimeSnapshot;
  attention: SessionAttentionNotifications;
}

const sessions = new Map<number, ManagedSession>();
const startupFailures = new Map<number, SessionRuntimeSnapshot>();
const pendingCommits = new Map<number, Promise<SessionRuntimeSnapshot>>();
const startingTabs = new Set<number>();
const snapshotWrites=new Map<number,Promise<void>>();
const courseUrls=new Map<number,string>();
interface PreparedCourse {id:string;tab_id:number;provider_profile_id:string;model_id:string;budget:ModelCallBudget;catalog:CourseCatalog;platform:CourseTabPlatform}
const preparedCourses=new Map<number,PreparedCourse>();
const preparationRuns=new Map<number,{controller:AbortController;platform:CourseTabPlatform;id:string}>();
const startupControllers=new Map<number,AbortController>();
const PREPARATION_PREFIX='vv-course-preparation:';
interface StoredPreparation {id:string;provider_profile_id:string;model_id:string;model_call_limit:number;used:number;catalog?:CourseCatalog;url:string;updated_at:number;loaded?:number;title?:string;phase?:'loading'|'ready'|'paused';notice?:string}
async function storedPreparation(tabId:number):Promise<StoredPreparation|undefined>{
  const frame=await chrome.webNavigation.getFrame({tabId,frameId:0});if(!frame?.url)return undefined;
  const url=courseResumeUrl(frame.url),records=await chrome.storage.local.get(null);
  const matches=Object.entries(records).filter(([key,value])=>key.startsWith(PREPARATION_PREFIX)&&((value as StoredPreparation).url===url||Boolean((value as StoredPreparation).catalog&&courseCatalogMatchesUrl(frame.url,(value as StoredPreparation).catalog!)))).map(([,value])=>value as StoredPreparation).sort((a,b)=>b.updated_at-a.updated_at);
  return matches[0];
}
function preparationView(prepared:StoredPreparation){return {preparation_id:prepared.id,catalog:prepared.catalog,provider_profile_id:prepared.provider_profile_id,model_id:prepared.model_id,model_calls:{used:prepared.used,limit:prepared.model_call_limit},loaded:prepared.loaded??prepared.catalog?.tasks.length??0,title:prepared.title??prepared.catalog?.title??'',phase:prepared.phase??(prepared.catalog?'ready':'paused'),notice:prepared.notice??null};}
async function restorePreparation(tabId:number):Promise<PreparedCourse|undefined>{
  if(preparedCourses.has(tabId))return preparedCourses.get(tabId);
  const saved=await storedPreparation(tabId);if(!saved?.catalog)return undefined;
  if(!Number.isInteger(saved.used)||saved.used<0||saved.used>saved.model_call_limit)throw new Error('课程准备预算无效。');
  const profile=await providerManager.get(saved.provider_profile_id);if(!profile||!profile.model_catalog.models.includes(saved.model_id))throw new Error('课程准备所用Provider或模型已被移除。');
  const budget=new ModelCallBudget(saved.model_call_limit);if(saved.used)budget.reserve(saved.used).settle(saved.used);
  budget.setPersistence(async used=>{saved.used=used;saved.updated_at=Date.now();await chrome.storage.local.set({[PREPARATION_PREFIX+saved.id]:saved});});
  const solver=new VercelAiSolverProvider(profile,saved.model_id,await providerManager.getApiKey(profile),budget,undefined,25000,true);
  const platform=new CourseTabPlatform(tabId,saved.id,saved.catalog.course_id,saved.catalog,(snapshot,signal)=>solver.recognizeCourse(snapshot,signal));
  const value={id:saved.id,tab_id:tabId,provider_profile_id:saved.provider_profile_id,model_id:saved.model_id,budget,catalog:saved.catalog,platform};preparedCourses.set(tabId,value);return value;
}
setInterval(()=>{
  if(startingTabs.size||[...sessions.values()].some(session=>!['PAUSED','COMPLETE','FAILED','CANCELLED'].includes(session.snapshot.state)))
    void chrome.runtime.getPlatformInfo().catch(error=>{for(const session of sessions.values())session.orchestrator.pause(publicError(error));});
},15000);
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
  const captured=structuredClone(snapshot),previous=snapshotWrites.get(tabId)??Promise.resolve(),managed=sessions.get(tabId);
  if(managed?.snapshot.session_id===captured.session_id)captured.model_calls.used=Math.max(captured.model_calls.used,managed.budget.used+managed.budget.reserved);
  const write=previous.then(async()=>{
    await chrome.storage.session.set({ [sessionSnapshotKey(tabId)]: captured });
    if(captured.course?.checkpoint){
      const stored=await chrome.storage.session.get('vv-start-request:'+tabId),request=stored['vv-start-request:'+tabId] as StartSessionRequest|undefined;
      if(!request)throw new Error('课程保存缺少原始任务配置。');
      const old=await chrome.storage.local.get(COURSE_RECORD_PREFIX+captured.session_id),record=old[COURSE_RECORD_PREFIX+captured.session_id] as SavedCourseRecord|undefined;
      const value=courseUrls.get(tabId)??record?.url??(await chrome.webNavigation.getFrame({tabId,frameId:0}))?.url;
      const url=value?courseResumeUrl(value):undefined;
      if(!url)throw new Error('课程保存缺少可恢复页面地址。');
      await chrome.storage.local.set({[COURSE_RECORD_PREFIX+captured.session_id]:{snapshot:captured,request,url,updated_at:Date.now()} satisfies SavedCourseRecord});
    }
  });
  snapshotWrites.set(tabId,write);
  await write;
}
function persistUpdate(tabId:number,snapshot:SessionRuntimeSnapshot):void {
  void saveSessionSnapshot(tabId,snapshot).catch(error=>{
    snapshotWrites.delete(tabId);const session=sessions.get(tabId);
    if(session&&session.snapshot.state!=='PAUSED')session.orchestrator.pause('会话保存失败：'+publicError(error));
  });
}

async function loadSessionSnapshot(tabId: number): Promise<SessionRuntimeSnapshot | undefined> {
  const key = sessionSnapshotKey(tabId);
  const result = await chrome.storage.session.get(key);
  const snapshot = result[key] as SessionRuntimeSnapshot | undefined;
  if (!snapshot) {
    const frame=await chrome.webNavigation.getFrame({tabId,frameId:0});if(!frame?.url)return undefined;
    const records=await chrome.storage.local.get(null);
    const matches=Object.entries(records).filter(([key,value])=>key.startsWith(COURSE_RECORD_PREFIX)&&!['COMPLETE','CANCELLED'].includes((value as SavedCourseRecord).snapshot.state)&&
      ![...sessions.values()].some(session=>session.snapshot.session_id===(value as SavedCourseRecord).snapshot.session_id)&&savedCourseMatches(frame.url,value as SavedCourseRecord)).map(([,value])=>value as SavedCourseRecord);
    if(matches.length>1)throw new Error('当前课程有多个保存任务，请在所有任务中选择需要恢复的任务。');
    const record=matches[0];if(!record)return undefined;
    courseUrls.set(tabId,frame.url);
    const recovered={...record.snapshot,state:'PAUSED' as const,notice:'课程断点已保存。确认登录后点击继续，重新核对平台记录。'};
    await chrome.storage.session.set({[key]:recovered,['vv-start-request:'+tabId]:{...record.request,tab_id:tabId}});
    return recovered;
  }
  return { ...snapshot, strategy: 'unattended' };
}

async function removeSessionSnapshot(tabId: number,keepCourse=false): Promise<void> {
  await snapshotWrites.get(tabId);
  const saved=await chrome.storage.session.get(sessionSnapshotKey(tabId)),snapshot=saved[sessionSnapshotKey(tabId)] as SessionRuntimeSnapshot|undefined;
  if(snapshot?.course&&!keepCourse)await chrome.storage.local.remove(COURSE_RECORD_PREFIX+snapshot.session_id);
  await chrome.storage.session.remove([sessionSnapshotKey(tabId),'vv-start-request:'+tabId]);
  snapshotWrites.delete(tabId);
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
    notice: stored.checkpoint||stored.course?.checkpoint||stored.practice?.checkpoint&&!stored.practice.checkpoint.child_active?'扩展后台曾被浏览器回收；可从保存的断点继续，先重新核对页面。':"扩展后台曾被浏览器回收；请核对已保存作答和提交结果后再重新启动。",
  };
  await saveSessionSnapshot(tabId, recovered);
  return recovered;
}

async function savePendingStart(request: ArmSessionStartRequest): Promise<void> {
  const active=await visibleSessionSnapshot(request.start_request.tab_id);
  if(active&&!['COMPLETE','CANCELLED','FAILED'].includes(active.state))throw new Error('当前标签已有任务，请继续或清除该任务。');
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
  const notice = session.attention.next(session.snapshot,await readUiLanguage());
  if (!notice) return;
  const id=await chrome.notifications.create(`vv-${tabId}-${Date.now()}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    ...notice,
  });
  recordTestEvent('notification',{id,type:'basic',iconUrl:NOTIFICATION_ICON,...notice});
}

async function startSession(request: StartSessionRequest,restore?:SessionRuntimeSnapshot,signal:AbortSignal=new AbortController().signal): Promise<SessionRuntimeSnapshot> {
  signal.throwIfAborted();
  await queueReady;
  const existing = sessions.get(request.tab_id);
  if (existing && !["COMPLETE", "CANCELLED", "FAILED"].includes(existing.snapshot.state)) {
    throw new Error("This tab already has an active VV session.");
  }
  if(restore&&[...sessions.values()].some(session=>session.snapshot.session_id===restore.session_id))throw new Error('这个课程断点已在另一个标签运行。');
  const profile = await providerManager.get(request.provider_profile_id);
  if (!profile) throw new Error("The selected Provider profile no longer exists.");
  if (!profile.model_catalog.models.includes(request.model_id)) {
    throw new Error("The selected model is not configured in this Provider profile.");
  }
  if (request.allow_native_search === true && !supportsNativeSearch(profile, request.model_id)) {
    throw new Error("当前 Provider 没有开启可用的原生网页搜索，请检查 Provider 设置。");
  }
  if (
    !request.course && !request.practice_course && request.observation_input_mode === "visual_snapshot" &&
    (!profile.image_upload_authorized || !profile.capabilities.image_input)
  ) {
    throw new Error("截图模式需要当前 Provider 已授权并支持图片输入。");
  }
  await requireCurrentWebsite(request.tab_id);
  await ensureContentInjected(request.tab_id);
  signal.throwIfAborted();

  const prepared=request.preparation_id&&!restore?await restorePreparation(request.tab_id):undefined;
  if(request.preparation_id&&!restore&&(!prepared||prepared.id!==request.preparation_id||prepared.model_id!==request.model_id||prepared.provider_profile_id!==request.provider_profile_id||prepared.budget.limit!==request.model_call_limit))throw new Error('课程准备与当前模型或预算配置不一致，请重新加载课程。');
  const budget = !restore&&prepared?prepared.budget:new ModelCallBudget(request.model_call_limit);
  if(restore){
    if(restore.model_calls.limit!==request.model_call_limit||!Number.isInteger(restore.model_calls.used)||restore.model_calls.used<0||restore.model_calls.used>budget.limit)throw new Error('恢复调用预算与原始任务配置不一致。');
    if(restore.model_calls.used)budget.reserve(restore.model_calls.used).settle(restore.model_calls.used);
  }
  budget.setPersistence(async charged=>{
    const session=sessions.get(request.tab_id),snapshot=session?.orchestrator.snapshot()??startupFailures.get(request.tab_id);
    if(!snapshot)throw new Error('Budget persistence requires an active session.');
    snapshot.model_calls.used=charged;await saveSessionSnapshot(request.tab_id,snapshot);
  });
  await chrome.storage.session.set({['vv-start-request:'+request.tab_id]:request});
  if(request.practice_course){
    if(request.course)throw new Error('请分别选择视频课程或知识点练习范围。');
    const catalog=await previewKnowledge(request.tab_id),expected=request.practice_course.catalog;
    if(catalog.course_id!==expected.course_id||catalog.context_id!==expected.context_id||catalog.revision!==expected.revision)throw new Error('知识点预览已改变，请重新读取并选择范围。');
    let managed:ManagedSession;
    const {orchestrator,platform}=createKnowledgeRun(request.tab_id,profile,await providerManager.getApiKey(profile),budget,
      {session_id:crypto.randomUUID(),model_id:request.model_id,catalog,scope:request.practice_course.scope,strategy:request.strategy,on_update:snapshot=>{
        managed.snapshot=snapshot;if(sessions.get(request.tab_id)!==managed)return;
        persistUpdate(request.tab_id,snapshot);void updateBadge(request.tab_id,snapshot);void notifyAttention(request.tab_id,managed).catch(()=>{});
        if(['PAUSED','COMPLETE','FAILED','CANCELLED'].includes(snapshot.state))void platform.disableInteraction().catch(()=>{});
      }});
    managed={budget,orchestrator,platform,attention:new SessionAttentionNotifications(),snapshot:{...orchestrator.snapshot(),state:'QUEUED',notice:'等待知识点练习运行名额。'}};
    sessions.set(request.tab_id,managed);startupFailures.delete(request.tab_id);await saveSessionSnapshot(request.tab_id,managed.snapshot);
    try{await platform.enableInteraction();}catch(e){orchestrator.stop('知识点人工操作保护安装失败。');sessions.delete(request.tab_id);throw e;}
    queue.enqueue(request.tab_id,()=>orchestrator.run());return managed.snapshot;
  }
  if (request.course) {
    const catalog=restore?.course?.checkpoint?.catalog??prepared?.catalog;
    if(!catalog)throw new Error('请先加载课程并确认范围。');
    if([...sessions.values()].some(session=>session.snapshot.course?.course_id===catalog.course_id&&session.snapshot.course.checkpoint?.catalog.context_id===catalog.context_id&&!['COMPLETE','CANCELLED','FAILED'].includes(session.snapshot.state)))throw new Error('这门课程已有运行任务，请在所有任务中继续该任务。');
    const sessionId=restore?.session_id??prepared!.id;
    const frame=await chrome.webNavigation.getFrame({tabId:request.tab_id,frameId:0});if(!frame?.url)throw new Error('课程页面已关闭。');courseUrls.set(request.tab_id,frame.url);
    const initial:SessionRuntimeSnapshot=restore??{session_id:sessionId,state:'WAIT_READY',strategy:request.strategy,observation_input_mode:'structured',provider_profile_id:profile.provider_profile_id,model_id:request.model_id,
      model_calls:{used:budget.used,limit:budget.limit},progress:{total:request.course.scope.length,answered:0,guessed:0,retried:0,skipped:0,failed:0},notice:'正在核对课程页面。',summary:null,
      course:{phase:'OBSERVE_COURSE',course_id:catalog.course_id,title:catalog.title,scope:request.course.scope,current_task_id:null,estimate_seconds:null,estimate_frozen:true,video:{ended:false,progress_recorded:false},results:[],tasks:catalog.tasks,excluded:[],checkpoint:{catalog,completed:[],children:[],pending_quiz:null}}};
    startupFailures.set(request.tab_id,initial);await saveSessionSnapshot(request.tab_id,initial);
    if(catalog.course_id!==request.course.course_id||catalog.platform!==request.course.platform||catalog.revision!==request.course.revision)throw new Error('课程预览已改变，请重新读取并选择范围。');
    let managed: ManagedSession;
    const {orchestrator,platform} = await createCourseRun(request.tab_id,profile,await providerManager.getApiKey(profile),budget,{
      session_id:sessionId,model_id:request.model_id,catalog,scope:request.course.scope,strategy:request.strategy,provider_profile_id:profile.provider_profile_id,...(restore?{restore}:{}),
      persist:snapshot=>saveSessionSnapshot(request.tab_id,snapshot),
      on_update:snapshot=>{
        managed.snapshot=snapshot;if(sessions.get(request.tab_id)!==managed)return;
        persistUpdate(request.tab_id,snapshot);void updateBadge(request.tab_id,snapshot);
        void notifyAttention(request.tab_id,managed).catch(()=>{});
        if(['PAUSED','COMPLETE','FAILED','CANCELLED'].includes(snapshot.state))void platform.disableInteraction().catch(()=>{});
      },
    },restore?undefined:prepared?.platform,signal);
    signal.throwIfAborted();
    managed={budget,orchestrator,platform,attention:new SessionAttentionNotifications(),snapshot:{...orchestrator.snapshot(),state:'QUEUED',notice:'等待课程运行名额。'}};
    sessions.set(request.tab_id,managed);startupFailures.delete(request.tab_id);
    preparedCourses.delete(request.tab_id);
    await saveSessionSnapshot(request.tab_id,managed.snapshot);
    if(prepared)await chrome.storage.local.remove(PREPARATION_PREFIX+prepared.id);
    try{await platform.enableInteraction();signal.throwIfAborted();}catch(error){orchestrator.pause('课程启动已暂停。');await platform.disableInteraction();throw error;}
    queue.enqueue(request.tab_id,()=>orchestrator.run());return managed.snapshot;
  }
  const solver = new VercelAiSolverProvider(
    profile,
    request.model_id,
    await providerManager.getApiKey(profile),
    budget,
    undefined,
    120_000,
    true,
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
    (snapshot, signal, capture) => solver.recognizeInitialSemantic(snapshot, signal, capture),
  );
  const sessionId = restore?.session_id??crypto.randomUUID();
  let managed: ManagedSession;
  const orchestrator = new QuizOrchestrator(platform, solver, new WebVerifier(), {
    session_id: sessionId,
    ...(restore?{restore}:{}),
    strategy: request.strategy,
    observation_input_mode: request.observation_input_mode,
    provider_profile_id: profile.provider_profile_id,
    model_id: request.model_id,
    model_call_limit: request.model_call_limit,
    model_call_budget: budget,
    image_upload_authorized: profile.image_upload_authorized,
    persist:snapshot=>saveSessionSnapshot(request.tab_id,snapshot),
    allow_native_search: request.allow_native_search ?? supportsNativeSearch(profile, request.model_id),
    on_update: (snapshot) => {
      managed.snapshot = snapshot;
      if (sessions.get(request.tab_id) !== managed) return;
      persistUpdate(request.tab_id, snapshot);
      void updateBadge(request.tab_id, snapshot);
      void notifyAttention(request.tab_id, managed).catch(() => { /* Notification delivery failure must not interrupt controlled execution. */ });
      if (["PAUSED", "COMPLETE", "FAILED", "CANCELLED"].includes(snapshot.state)) {
        void platform.disableInteraction().catch(() => { /* Navigated/closed pages remain locally blocked. */ });
      }
    },
  });
  managed = { budget,orchestrator, platform, attention: new SessionAttentionNotifications(), snapshot: { ...orchestrator.snapshot(), state: "QUEUED", notice: "等待并行运行名额。" } };
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
  const controller=new AbortController();startupControllers.set(request.tab_id,controller);
  try { return await startSession(request,undefined,controller.signal); }
  catch(error){const snapshot=startupFailures.get(request.tab_id);if(snapshot?.course&&!['PAUSED','CANCELLED'].includes(snapshot.state)){snapshot.state='PAUSED';snapshot.notice=publicError(error);await saveSessionSnapshot(request.tab_id,snapshot);}throw error;}
  finally { startingTabs.delete(request.tab_id);startupControllers.delete(request.tab_id); }
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
      if (snapshot) tasks.push({ tab_id: tabId, title: tab.title || `标签 ${tabId}`, url: tab.url ?? null, provider_name: (await providerManager.get(snapshot.provider_profile_id))?.display_name || "Provider 已移除", snapshot, resumable: sessions.has(tabId)||snapshot.state==='PAUSED'&&Boolean(snapshot.checkpoint||snapshot.course?.checkpoint||snapshot.practice?.checkpoint?.child_active===false) });
    } catch { /* A closed target is not a task. */ }
  }
  const records=await chrome.storage.local.get(null),activeIds=new Set(tasks.map(task=>task.snapshot.session_id));
  for(const [key,value] of Object.entries(records)){
    if(!key.startsWith(COURSE_RECORD_PREFIX))continue;const record=value as SavedCourseRecord;
    if(activeIds.has(record.snapshot.session_id))continue;
    tasks.push({tab_id:-1,saved_session_id:record.snapshot.session_id,title:record.snapshot.course!.title,url:record.url,provider_name:(await providerManager.get(record.snapshot.provider_profile_id))?.display_name??'Provider 已移除',
      snapshot:['COMPLETE','CANCELLED'].includes(record.snapshot.state)?record.snapshot:{...record.snapshot,state:'PAUSED',notice:'打开课程并登录后，可以继续保存的任务。'},resumable:false});
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
    const preparing=tabId===undefined?undefined:preparationRuns.get(tabId);
    if(preparing?.platform.interactionMatches(request.session_id,request.epoch)){preparing.controller.abort(new Error('检测到课程页面人工操作，课程加载已取消。'));await preparing.platform.disableInteraction();return {paused:true};}
    const session = tabId === undefined ? undefined : sessions.get(tabId);
    if (!session || !session.platform.interactionMatches(request.session_id, request.epoch)) return { ignored: true };
    queue.cancelQueued(tabId!);
    session.orchestrator.pause("检测到你在测验页面点击或输入，已暂停。继续后会重新读取当前题目。");
    return { paused: true };
  }
  if (sender.url && !sender.url.startsWith(chrome.runtime.getURL(""))) {
    throw new Error("Website content may only report manual interaction in its own session.");
  }
  if (request.type === 'VV_GET_BUILD') return { build_id: __VV_BUILD_ID__, strategy: 'unattended' };
  if(request.type==='VV_GET_COURSE_PREPARATION'){
    const saved=await storedPreparation(request.tab_id);if(!saved)return null;
    if(saved.phase==='loading'&&![...preparationRuns.values()].some(run=>run.id===saved.id))return preparationView({...saved,phase:'paused',notice:'课程加载尚未完成。请点击加载当前课程接续已有预算。'});
    return preparationView(saved);
  }
  if(request.type==='VV_CANCEL_COURSE_PREPARATION'){
    const preparing=preparationRuns.get(request.tab_id);if(preparing){preparing.controller.abort(new Error('用户取消课程加载。'));await preparing.platform.disableInteraction();}
    return {cancelled:Boolean(preparing)};
  }
  if(request.type==='VV_CLEAR_SAVED_COURSE'){
    if([...sessions.values()].some(session=>session.snapshot.session_id===request.session_id))throw new Error('请先停止并清除正在使用的课程任务。');
    await chrome.storage.local.remove(COURSE_RECORD_PREFIX+request.session_id);return {cleared:true};
  }
  if(request.type==='VV_PREPARE_COURSE'){
    const active=await visibleSessionSnapshot(request.tab_id);
    if(active&&!['COMPLETE','CANCELLED','FAILED'].includes(active.state)||startingTabs.has(request.tab_id))throw new Error('当前标签已有任务，请继续或清除该任务后加载课程。');
    const profile=await providerManager.get(request.provider_profile_id);
    if(!profile||!profile.model_catalog.models.includes(request.model_id))throw new Error('请先选择已配置的Provider和模型。');
    if(!profile.capabilities.structured_output)throw new Error('课程识别需要支持结构化输出的模型。');
    const frame=await chrome.webNavigation.getFrame({tabId:request.tab_id,frameId:0});if(!frame?.url)throw new Error('当前课程页面已关闭。');
    const old=await storedPreparation(request.tab_id),compatible=old?.provider_profile_id===request.provider_profile_id&&old.model_id===request.model_id&&old.model_call_limit===request.model_call_limit;
    if(old&&[...preparationRuns.values()].some(run=>run.id===old.id))throw new Error('这门课程正在加载，请等待加载完成。');
    if(compatible&&old.catalog){preparedCourses.delete(request.tab_id);return preparationView(old);}
    const id=compatible?old!.id:crypto.randomUUID(),budget=new ModelCallBudget(request.model_call_limit);
    if(compatible&&old!.used)budget.reserve(old!.used).settle(old!.used);
    const key=PREPARATION_PREFIX+id,saved:StoredPreparation={id,provider_profile_id:request.provider_profile_id,model_id:request.model_id,model_call_limit:request.model_call_limit,used:budget.used,url:courseResumeUrl(frame.url),updated_at:Date.now(),phase:'loading',loaded:0};
    budget.setPersistence(async used=>{saved.used=used;saved.updated_at=Date.now();await chrome.storage.local.set({[key]:saved});});
    const reader=new VercelAiSolverProvider(profile,request.model_id,await providerManager.getApiKey(profile),budget,undefined,25000,true);
    const platform=new CourseTabPlatform(request.tab_id,id,'loading',undefined,(snapshot,signal)=>reader.recognizeCourse(snapshot,signal));
    startingTabs.add(request.tab_id);
    const controller=new AbortController();preparationRuns.set(request.tab_id,{controller,platform,id});
    try{
      await chrome.storage.local.set({[key]:saved});
      const catalog=await platform.prepare(controller.signal,async progress=>{saved.loaded=progress.loaded;saved.title=progress.title;saved.updated_at=Date.now();await chrome.storage.local.set({[key]:saved});});controller.signal.throwIfAborted();
      preparedCourses.set(request.tab_id,{id,tab_id:request.tab_id,provider_profile_id:request.provider_profile_id,model_id:request.model_id,budget,catalog,platform});
      saved.catalog=catalog;saved.phase='ready';saved.used=budget.used;saved.updated_at=Date.now();const current=await chrome.webNavigation.getFrame({tabId:request.tab_id,frameId:0});if(current?.url)saved.url=courseResumeUrl(current.url);await chrome.storage.local.set({[key]:saved});
      return preparationView(saved);
    }catch(error){saved.phase='paused';saved.notice=publicError(error);await chrome.storage.local.set({[key]:saved});throw error;}
    finally{preparationRuns.delete(request.tab_id);startingTabs.delete(request.tab_id);await platform.disableInteraction();}
  }
  if(request.type==='VV_OPEN_SAVED_COURSE'){
    const key=COURSE_RECORD_PREFIX+request.session_id,stored=await chrome.storage.local.get(key),record=stored[key] as SavedCourseRecord|undefined;
    if(!record)throw new Error('保存的课程已被清除。');
    const tab=await chrome.tabs.create({url:record.url});
    if(tab.id===undefined)throw new Error('课程标签创建失败。');
    courseUrls.set(tab.id,record.url);
    await chrome.storage.session.set({[sessionSnapshotKey(tab.id)]:{...record.snapshot,state:'PAUSED',notice:'课程断点已保存。确认登录后点击继续。'},['vv-start-request:'+tab.id]:{...record.request,tab_id:tab.id}});
    return tab;
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
  if((request.type==='VV_PAUSE_SESSION'||request.type==='VV_STOP_SESSION')&&startupControllers.has(request.tab_id)){
    startupControllers.get(request.tab_id)!.abort(new Error('课程启动已取消。'));
    if(session){if(request.type==='VV_STOP_SESSION')session.orchestrator.stop();else session.orchestrator.pause();await session.platform.disableInteraction();return session.orchestrator.snapshot();}
    const snapshot=startupFailures.get(request.tab_id);if(snapshot){snapshot.state=request.type==='VV_STOP_SESSION'?'CANCELLED':'PAUSED';snapshot.notice='课程启动已取消，断点保留。';await saveSessionSnapshot(request.tab_id,snapshot);return snapshot;}
    return null;
  }
  if (request.type === "VV_CLEAR_SESSION" && !session) {
    startupFailures.delete(request.tab_id);
    await removePendingStart(request.tab_id);
    await removeSessionSnapshot(request.tab_id);
    await chrome.action.setBadgeText({ tabId: request.tab_id, text: "" });
    return null;
  }
  if(request.type==='VV_RESUME_SESSION'&&!session){
    const recovered=await visibleSessionSnapshot(request.tab_id);
    if(recovered?.state==='PAUSED'&&(recovered.checkpoint||recovered.course?.checkpoint)){
      const stored=await chrome.storage.session.get('vv-start-request:'+request.tab_id),requestToResume=stored['vv-start-request:'+request.tab_id] as StartSessionRequest|undefined;
      if(!requestToResume||requestToResume.provider_profile_id!==recovered.provider_profile_id)throw new Error('恢复缺少原始任务配置。');
      if(startingTabs.has(request.tab_id))throw new Error('会话恢复正在执行，请等待完成。');
      startingTabs.add(request.tab_id);
      const controller=new AbortController();startupControllers.set(request.tab_id,controller);
      try {return await startSession({...requestToResume,model_id:recovered.model_id},recovered,controller.signal);}
      catch(error){
        const snapshot=startupFailures.get(request.tab_id)??recovered;
        if(!['PAUSED','CANCELLED'].includes(snapshot.state)){snapshot.state='PAUSED';snapshot.notice=publicError(error);await saveSessionSnapshot(request.tab_id,snapshot);}
        throw error;
      }
      finally {startingTabs.delete(request.tab_id);startupControllers.delete(request.tab_id);}
    }
    const snapshot=await visibleSessionSnapshot(request.tab_id),practice=snapshot?.practice,checkpoint=practice?.checkpoint;
    if(!snapshot||snapshot.state!=='PAUSED'||!checkpoint||checkpoint.child_active)throw new Error('后台恢复缺少安全断点；请先核对已有作答/提交，禁止盲目重做。');
    await requireCurrentWebsite(request.tab_id);
    const profile=await providerManager.get(snapshot.provider_profile_id);if(!profile)throw new Error('Provider已移除，不能恢复。');
    const budget=new ModelCallBudget(snapshot.model_calls.limit);if(snapshot.model_calls.used)budget.reserve(snapshot.model_calls.used).settle(snapshot.model_calls.used);
    let managed:ManagedSession;
    const {orchestrator,platform}=createKnowledgeRun(request.tab_id,profile,await providerManager.getApiKey(profile),budget,
      {session_id:snapshot.session_id,model_id:snapshot.model_id,catalog:checkpoint.catalog,scope:practice.scope,strategy:snapshot.strategy,restore:snapshot,on_update:next=>{
        managed.snapshot=next;if(sessions.get(request.tab_id)!==managed)return;
        persistUpdate(request.tab_id,next);void updateBadge(request.tab_id,next);void notifyAttention(request.tab_id,managed).catch(()=>{});
        if(['PAUSED','COMPLETE','FAILED','CANCELLED'].includes(next.state))void platform.disableInteraction().catch(()=>{});
      }});
    managed={budget,orchestrator,platform,attention:new SessionAttentionNotifications(),snapshot:orchestrator.snapshot()};sessions.set(request.tab_id,managed);session=managed;
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
  port.onMessage.addListener(() => {});
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
  if(details.frameId===0&&sessions.get(details.tabId)?.snapshot.course)courseUrls.set(details.tabId,details.url);
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
  startupControllers.get(tabId)?.abort(new Error('课程标签已关闭。'));
  preparationRuns.get(tabId)?.controller.abort(new Error('课程标签已关闭。'));preparedCourses.delete(tabId);
  latestMainNavigation.delete(tabId);
  queue.cancelQueued(tabId);
  const session = sessions.get(tabId);
  if(session?.snapshot.course)session.orchestrator.pause('课程标签已关闭，断点保留。');else session?.orchestrator.stop("The target tab was closed.");
  sessions.delete(tabId);
  startupFailures.delete(tabId);
  void removePendingStart(tabId);
  void removeSessionSnapshot(tabId,Boolean(session?.snapshot.course));
});

chrome.debugger.onDetach.addListener(source => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  if(!hasActiveDebuggerTransport(tabId))return;
  const session = sessions.get(tabId);
  if (session && !["PAUSED", "COMPLETE", "CANCELLED", "FAILED"].includes(session.snapshot.state)) {
    queue.cancelQueued(tabId);
    session.orchestrator.pause("视觉页面控制连接已断开，请检查页面后再继续。");
  }
});

void resumeAuthorizedPendingStarts();
