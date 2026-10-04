import type { ObservationInputMode, ProviderProfile, RunStrategy, SessionRuntimeSnapshot } from "../core";
import { ProviderManager } from "../provider/provider-manager";
import type { ExtensionRequest } from "./messages";
import { ChromeLocalStore } from "./storage";
import { supportsNativeSearch } from "../provider/provider-capabilities";
import { requestCurrentWebsite } from "./website-access";
import { courseModels, validateCourseScope } from '../core/course';
import type { CourseCatalog } from '../core/course';
import type { CourseInspectionBundle } from '../web/course-inspection';
import {validateKnowledgeScope} from '../core/knowledge-practice';
import type {KnowledgeCatalog} from '../core/knowledge-practice';

interface RuntimeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

interface PopupPreferences {
  provider_profile_id?: string;
  model_id?: string;
  strategy?: RunStrategy;
  observation_input_mode?: ObservationInputMode;
}

const POPUP_PREFERENCES_KEY = "vv-popup-preferences";

const manager = new ProviderManager(new ChromeLocalStore());
document.querySelector("#open-tasks")!.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("tasks.html") });
});
const providerSelect = document.querySelector<HTMLSelectElement>("#provider")!;
const modelSelect = document.querySelector<HTMLSelectElement>("#model")!;
const strategySelect = document.querySelector<HTMLSelectElement>("#strategy")!;
const callLimit = document.querySelector<HTMLInputElement>("#call-limit")!;
const inputMode = document.querySelector<HTMLInputElement>("#input-mode")!;
const nativeSearch = document.querySelector<HTMLInputElement>("#native-search")!;
const modeSlider = document.querySelector<HTMLElement>("#mode-slider")!;
const inputModeTitle = document.querySelector<HTMLElement>("#input-mode-title")!;
const inputModeDescription = document.querySelector<HTMLElement>("#input-mode-description")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear")!;
const applyStrategyButton = document.querySelector<HTMLButtonElement>("#apply-strategy")!;
const statusText = document.querySelector<HTMLElement>("#session-status")!;
const detailText = document.querySelector<HTMLElement>("#session-detail")!;
const progressText = document.querySelector<HTMLElement>("#session-progress")!;
let profiles: ProviderProfile[] = [];
let activeTabId: number | undefined;
let activeTabUrl: string | undefined;
let port: chrome.runtime.Port | undefined;
let courseCatalog: CourseCatalog | null = null;
let knowledgeCatalog:KnowledgeCatalog|null=null;
let hasLiveSession=false;
const courseRange = document.querySelector<HTMLSelectElement>('#course-range')!;
const courseStart = document.querySelector<HTMLButtonElement>('#start-course')!;
const coursePreview = document.querySelector<HTMLElement>('#course-preview')!;
const courseInspect = document.querySelector<HTMLButtonElement>('#inspect-course')!;
const courseExport = document.querySelector<HTMLButtonElement>('#export-course-inspection')!;
const courseInspectionOutput = document.querySelector<HTMLTextAreaElement>('#course-inspection')!;
const courseInspectionStatus = document.querySelector<HTMLElement>('#course-inspection-status')!;
let courseInspection: CourseInspectionBundle | null = null;
function courseScope():string[] {
  if(knowledgeCatalog&&courseRange.value)return knowledgeCatalog.points.filter(p=>courseRange.value==='all'||courseRange.value==='point:'+p.id).map(p=>p.id);
  if(!courseCatalog||!courseRange.value)return [];
  return courseCatalog.tasks.filter(task=>task.kind!=='excluded'&&(courseRange.value==='all'||courseRange.value==='lesson:'+task.lesson_id||courseRange.value==='chapter:'+task.chapter_id)).map(task=>task.id);
}
function renderCourseScope():void {
  const ids=courseScope();const container=document.querySelector('#course-tasks')!;container.replaceChildren();
  for(const task of courseCatalog?.tasks.filter(t=>ids.includes(t.id))??[]){const p=document.createElement('p');p.textContent=`${task.title} · ${task.kind} · ${task.status}`;container.append(p);}
  for(const point of knowledgeCatalog?.points.filter(p=>ids.includes(p.id))??[]){const p=document.createElement('p');p.textContent=point.title+' · 练习记录进入后逐项核对';container.append(p);}
  courseStart.disabled=ids.length===0||hasLiveSession;
}
courseRange.addEventListener('change',renderCourseScope);
courseInspect.addEventListener('click',()=>{
  void(async()=>{
    courseInspect.disabled=true;courseExport.disabled=true;courseInspection=null;
    courseInspectionOutput.value='';courseInspectionOutput.hidden=true;
    courseInspectionStatus.textContent='正在只读采集当前页面及已授权frame…';
    if(activeTabId===undefined)throw new Error('没有当前网站标签页。');
    await requestCurrentWebsite(activeTabId);
    const result=await send<CourseInspectionBundle>({type:'VV_INSPECT_COURSE',tab_id:activeTabId});
    courseInspection=result;
    courseInspectionOutput.value=JSON.stringify(result,null,2);courseInspectionOutput.hidden=false;
    courseExport.disabled=false;
    const failures=result.frames.filter(frame=>frame.error);
    courseInspectionStatus.textContent=`只读资料已生成：${result.frames.length-failures.length}/${result.frames.length}个frame。`+
      (failures.length?'部分frame未读取，请保留错误标记；资料不完整。':'')+'检查可见个人信息后可导出JSON或复制；未播放、作答、提交或调用模型。';
  })().catch(error=>{courseInspectionStatus.textContent=String(error.message||error);}).finally(()=>{courseInspect.disabled=false;});
});
courseExport.addEventListener('click',()=>{
  if(!courseInspection||!courseInspectionOutput.value)return;
  const blob=new Blob([courseInspectionOutput.value],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  const platform=courseInspection.frames.find(frame=>frame.frame_id===0)?.inspection?.platform??'page';
  link.href=url;link.download=`vv-course-${platform}-${courseInspection.captured_at.replace(/[:.]/g,'-')}.json`;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
document.querySelector('#preview-course')!.addEventListener('click',()=>{
  void (async()=>{
    knowledgeCatalog=null;courseCatalog=null;courseRange.replaceChildren();courseRange.disabled=true;courseStart.disabled=true;
    renderCourseScope();coursePreview.textContent='正在只读核对目录…';
    if(activeTabId===undefined)throw new Error('没有当前课程标签页。');
    await requestCurrentWebsite(activeTabId);
    const catalog=await send<CourseCatalog>({type:'VV_PREVIEW_COURSE',tab_id:activeTabId});
    if(!catalog.complete||catalog.diagnostics.length)throw new Error(catalog.diagnostics.join('；')||'目录不完整。');
    courseCatalog=catalog;coursePreview.textContent=`${catalog.platform==='chaoxing'?'学习通':'知到'} · ${catalog.title} · ${catalog.tasks.length}个已识别任务`;
    courseRange.replaceChildren();
    for(const [value,label] of [['','请选择范围'],['all','本次已识别的视频与测验范围'],
      ...[...new Set(catalog.tasks.map(t=>t.chapter_id))].map(id=>['chapter:'+id,'章节 '+id]),
      ...[...new Set(catalog.tasks.map(t=>t.lesson_id))].map(id=>['lesson:'+id,'课时 '+id])]){const option=document.createElement('option');option.value=value!;option.textContent=label!;courseRange.append(option);}
    courseRange.disabled=false;renderCourseScope();
  })().catch(error=>{coursePreview.textContent=String(error.message||error);});
});
document.querySelector('#preview-practices')!.addEventListener('click',()=>{
  void(async()=>{
    knowledgeCatalog=null;courseCatalog=null;courseRange.replaceChildren();courseRange.disabled=true;courseStart.disabled=true;renderCourseScope();
    if(activeTabId===undefined)throw new Error('请进入知到知识点目录。');await requestCurrentWebsite(activeTabId);
    const catalog=await send<KnowledgeCatalog>({type:'VV_PREVIEW_PRACTICES',tab_id:activeTabId});knowledgeCatalog=catalog;
    coursePreview.textContent=`知到 · ${catalog.points.length}个已加载知识点；本范围仅核对关联练习，不代表整个课程目录完整。`;
    for(const [value,label] of [['','请选择练习范围'],['all','当前已加载知识点的首次练习'],...catalog.points.map(p=>['point:'+p.id,p.title])]){
      const option=document.createElement('option');option.value=value!;option.textContent=label!;courseRange.append(option);
    }
    courseRange.disabled=false;renderCourseScope();
  })().catch(error=>{coursePreview.textContent=String(error.message||error);});
});
courseStart.addEventListener('click',()=>{
  void (async()=>{
    if((!courseCatalog&&!knowledgeCatalog)||activeTabId===undefined)throw new Error('请先读取并选择课程范围。');
    const scope=courseScope();if(knowledgeCatalog)validateKnowledgeScope(knowledgeCatalog,scope);else validateCourseScope(courseCatalog!,scope);
    const profile=profiles.find(p=>p.provider_profile_id===providerSelect.value);if(!profile)throw new Error('请先配置Provider。');
    const model=courseModels(profile.model_catalog.models)[0];if(!model)throw new Error('当前Provider没有授权Gemini课程模型。');
    const limit=Number(callLimit.value);if(!Number.isInteger(limit)||limit<=0)throw new Error('调用上限必须为正整数。');
    await requestCurrentWebsite(activeTabId);
    const snapshot=await send<SessionRuntimeSnapshot>({type:'VV_START_SESSION',tab_id:activeTabId,provider_profile_id:profile.provider_profile_id,model_id:model,
      strategy:strategySelect.value as RunStrategy,model_call_limit:limit,observation_input_mode:'structured',
      ...(knowledgeCatalog?{practice_course:{catalog:knowledgeCatalog,scope}}:{course:{course_id:courseCatalog!.course_id,platform:courseCatalog!.platform,scope,revision:courseCatalog!.revision}})});
    renderSession(snapshot);
  })().catch(error=>setError(String(error.message||error)));
});

const INPUT_MODES: Array<{ value: ObservationInputMode; title: string; description: string }> = [
  { value: "structured", title: "仅结构化数据", description: "只发送数据分离层提取的题干、选项和必要图片。" },
  { value: "semantic_snapshot", title: "快照模式", description: "开始后首次模型请求发送当前页面语义快照；识别结果经本地验证后进入答题。" },
  { value: "visual_snapshot", title: "截图模式", description: "开始后首次模型请求发送当前可见页面截图；需已授权图片输入，识别结果经本地验证后操作，浏览器可能显示调试连接提示。" },
];

function selectedInputMode(): ObservationInputMode {
  return INPUT_MODES[Math.round(Number(inputMode.value))]?.value ?? "semantic_snapshot";
}

function renderInputMode(): void {
  const position = Math.max(0, Math.min(2, Number(inputMode.value) || 0));
  const selected = INPUT_MODES[Math.round(position)] ?? INPUT_MODES[0]!;
  modeSlider.style.setProperty("--mode-position", String(position / 2));
  inputModeTitle.textContent = selected.title;
  inputModeDescription.textContent = selected.description;
}

function snapInputMode(): void {
  modeSlider.classList.remove("is-dragging");
  inputMode.value = String(Math.round(Number(inputMode.value)));
  renderInputMode();
  void savePreferences();
}

function setError(message: string): void {
  statusText.textContent = "需要处理";
  statusText.dataset.kind = "error";
  detailText.textContent = message;
}

function sitePattern(urlValue: string): string {
  const url = new URL(urlValue);
  return `${url.origin}/*`;
}

async function tabSitePermissionOrigins(tabId: number, fallbackUrl: string): Promise<string[]> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return [...new Set(
    [fallbackUrl, ...(frames?.map((frame) => frame.url) ?? [])]
      .filter((url) => url.startsWith("http"))
      .map(sitePattern),
  )];
}

async function send<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as RuntimeResponse<T>;
  if (!response.ok) throw new Error(response.error ?? "扩展操作失败。");
  return response.result as T;
}

function renderModels(): void {
  const profile = profiles.find((item) => item.provider_profile_id === providerSelect.value);
  modelSelect.replaceChildren();
  for (const model of profile?.model_catalog.models ?? []) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.append(option);
  }
  renderSearchPermission();
}

function renderSearchPermission(): void {
  const profile = profiles.find(item => item.provider_profile_id === providerSelect.value);
  const supported = Boolean(profile && supportsNativeSearch(profile, modelSelect.value));
  nativeSearch.disabled = !supported;
  if (!supported) nativeSearch.checked = false;
}

async function loadPreferences(): Promise<PopupPreferences> {
  const result = await chrome.storage.local.get(POPUP_PREFERENCES_KEY);
  const preferences = result[POPUP_PREFERENCES_KEY];
  return preferences && typeof preferences === "object" ? preferences as PopupPreferences : {};
}

async function savePreferences(): Promise<void> {
  await chrome.storage.local.set({
    [POPUP_PREFERENCES_KEY]: {
      provider_profile_id: providerSelect.value,
      model_id: modelSelect.value,
      strategy: strategySelect.value as RunStrategy,
      observation_input_mode: selectedInputMode(),
    } satisfies PopupPreferences,
  });
}

function renderSession(snapshot: SessionRuntimeSnapshot | null): void {
  hasLiveSession=Boolean(snapshot&&!['COMPLETE','CANCELLED','FAILED'].includes(snapshot.state));
  const active = snapshot && !["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(snapshot.state);
  statusText.dataset.kind = snapshot?.state === "FAILED" ? "error" : snapshot?.state === "PAUSED" ? "warning" : "";
  statusText.textContent = snapshot?.state ?? "未启动";
  detailText.textContent = /question_not_found|readiness_timeout/.test(snapshot?.notice??'')
    ? '当前题目尚未通过本地就绪或结构验证。请确认已进入答题页、已授予该页网站权限；模型调用次数见下方，可生成只读结构资料定位原因。'
    : snapshot?.notice ?? "打开一个逐题测验后启动。";
  progressText.textContent = snapshot
    ? `已答 ${snapshot.progress.answered} · 猜答 ${snapshot.progress.guessed} · 重试 ${snapshot.progress.retried} · 调用 ${snapshot.model_calls.used}/${snapshot.model_calls.limit}`
    : "";
  if(snapshot?.course){
    detailText.textContent=[snapshot.notice,`${snapshot.course.title} · ${snapshot.course.phase}`,
      `预计剩余播放时间：${snapshot.course.estimate_seconds===null?'暂无法估计':snapshot.course.estimate_seconds+'秒'}${snapshot.course.estimate_frozen?'（冻结）':''}；不含答题、缓冲及平台同步耗时。`].filter(Boolean).join('\n');
  }
  if(snapshot?.practice){
    const results=snapshot.practice.results;
    detailText.textContent=[snapshot.notice,snapshot.practice.title+' · '+snapshot.practice.phase,
      ...results.map(r=>`${r.title}：${r.status==='submitted'?'本次已提交 '+(r.score??'结果已确认'):r.status==='existing_record'?'已有作答记录，未重做':'页面明确免考／无练习'}`),
      '本范围不包含视频、文档或期末考试；提交成功不等同于及格。'].filter(Boolean).join('\n');
    progressText.textContent=`知识点 ${results.length}/${snapshot.practice.scope.length} 已核对 · 新提交 ${results.filter(r=>r.status==='submitted').length} · 调用 ${snapshot.model_calls.used}/${snapshot.model_calls.limit}`;
  }
  courseStart.disabled=hasLiveSession||courseScope().length===0;
  startButton.disabled = Boolean(snapshot && !["COMPLETE", "CANCELLED", "FAILED"].includes(snapshot.state));
  inputMode.disabled = Boolean(snapshot && !["COMPLETE", "CANCELLED", "FAILED"].includes(snapshot.state));
  pauseButton.disabled = !active;
  resumeButton.disabled = snapshot?.state !== "PAUSED";
  stopButton.disabled = !snapshot || ["COMPLETE", "CANCELLED", "FAILED"].includes(snapshot.state);
  clearButton.disabled = !snapshot || !["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(snapshot.state);
  applyStrategyButton.disabled = !snapshot || ["COMPLETE", "CANCELLED", "FAILED"].includes(snapshot.state);
  if (snapshot) {
    strategySelect.value = snapshot.strategy;
    const modeIndex = INPUT_MODES.findIndex((item) => item.value === snapshot.observation_input_mode);
    if (modeIndex >= 0) inputMode.value = String(modeIndex);
    renderInputMode();
  }
}

async function refreshSession(): Promise<void> {
  if (activeTabId === undefined) return;
  try {
    renderSession(await send<SessionRuntimeSnapshot | null>({ type: "VV_GET_SESSION", tab_id: activeTabId }));
  } catch (error) {
    setError(error instanceof Error ? error.message : "无法读取会话状态。");
  }
}

async function initialize(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  activeTabUrl = tab?.url;

  profiles = await manager.list();
  const preferences = await loadPreferences();
  providerSelect.replaceChildren();
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.provider_profile_id;
    option.textContent = profile.display_name;
    providerSelect.append(option);
  }
  if (preferences.provider_profile_id && profiles.some((profile) => profile.provider_profile_id === preferences.provider_profile_id)) {
    providerSelect.value = preferences.provider_profile_id;
  }
  renderModels();
  if (preferences.model_id && Array.from(modelSelect.options).some((option) => option.value === preferences.model_id)) {
    modelSelect.value = preferences.model_id;
  }
  renderSearchPermission();
  if (preferences.strategy && ["supervised", "unattended"].includes(preferences.strategy)) {
    strategySelect.value = preferences.strategy;
  }
  const modeIndex = INPUT_MODES.findIndex((item) => item.value === preferences.observation_input_mode);
  inputMode.value = String(modeIndex >= 0 ? modeIndex : 1);
  renderInputMode();

  if (profiles.length === 0) {
    setError("请先在设置中添加 Provider。");
    startButton.disabled = true;
    return;
  }

  if (activeTabId === undefined || !activeTabUrl?.startsWith("http")) {
    setError("当前页面不是可授权的 HTTP/HTTPS 测验页面。");
    startButton.disabled = true;
    return;
  }
  port = chrome.runtime.connect({ name: "vv-control" });
  port.postMessage({ tab_id: activeTabId });
  await refreshSession();
  window.setInterval(() => void refreshSession(), 750);
}

providerSelect.addEventListener("change", () => {
  nativeSearch.checked = false;
  renderModels();
  void savePreferences();
});
modelSelect.addEventListener("change", () => { nativeSearch.checked = false; renderSearchPermission(); void savePreferences(); });
strategySelect.addEventListener("change", () => void savePreferences());
inputMode.addEventListener("pointerdown", () => modeSlider.classList.add("is-dragging"));
inputMode.addEventListener("input", renderInputMode);
inputMode.addEventListener("change", snapInputMode);
inputMode.addEventListener("pointercancel", snapInputMode);
inputMode.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = Math.round(Number(inputMode.value));
  inputMode.value = String(event.key === "Home" ? 0 : event.key === "End" ? 2 : Math.max(0, Math.min(2, current + (event.key === "ArrowRight" ? 1 : -1))));
  snapInputMode();
});
document.querySelector("#open-options")?.addEventListener("click", () => chrome.runtime.openOptionsPage());

startButton.addEventListener("click", async () => {
  if (activeTabId === undefined || !activeTabUrl) return;
  try {
    const limit = Number(callLimit.value);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("模型调用上限必须是正整数。");
    const startRequest = {
      type: "VV_START_SESSION",
      tab_id: activeTabId,
      provider_profile_id: providerSelect.value,
      model_id: modelSelect.value,
      strategy: strategySelect.value as RunStrategy,
      model_call_limit: limit,
      observation_input_mode: selectedInputMode(),
      allow_native_search: !nativeSearch.disabled && nativeSearch.checked,
    } satisfies ExtensionRequest;
    await savePreferences();
    const origins = await tabSitePermissionOrigins(activeTabId, activeTabUrl);
    await send({
      type: "VV_ARM_SESSION_START",
      start_request: startRequest,
      required_origins: origins,
    });
    const granted = await chrome.permissions.request({ origins });
    if (!granted) {
      await send({ type: "VV_CANCEL_SESSION_START", tab_id: activeTabId });
      throw new Error("未授予当前测验网站权限。");
    }
    const snapshot = await send<SessionRuntimeSnapshot>({
      type: "VV_COMMIT_SESSION_START",
      tab_id: activeTabId,
    });
    renderSession(snapshot);
  } catch (error) {
    setError(error instanceof Error ? error.message : "启动失败。");
  }
});

pauseButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  renderSession(await send({ type: "VV_PAUSE_SESSION", tab_id: activeTabId }));
});
resumeButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  try {
    await requestCurrentWebsite(activeTabId);
    renderSession(await send({ type: "VV_RESUME_SESSION", tab_id: activeTabId }));
  } catch (error) { setError(error instanceof Error ? error.message : "恢复失败。"); }
});
applyStrategyButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  renderSession(
    await send({
      type: "VV_SWITCH_STRATEGY",
      tab_id: activeTabId,
      strategy: strategySelect.value as RunStrategy,
    }),
  );
});
stopButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  renderSession(await send({ type: "VV_STOP_SESSION", tab_id: activeTabId }));
});
clearButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  await send({ type: "VV_CLEAR_SESSION", tab_id: activeTabId });
  renderSession(null);
});

void initialize();
