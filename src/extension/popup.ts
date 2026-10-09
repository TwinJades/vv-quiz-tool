import type { ObservationInputMode, ProviderProfile, RunStrategy, SessionRuntimeSnapshot } from "../core";
import { ProviderManager } from "../provider/provider-manager";
import type { ExtensionRequest } from "./messages";
import { ChromeLocalStore } from "./storage";
import { supportsNativeSearch } from "../provider/provider-capabilities";
import { activeWebsiteFrame, requestCurrentWebsite } from "./website-access";
import { validateCourseScope,courseScopeForSelection } from '../core/course';
import type { CourseCatalog } from '../core/course';
import {validateKnowledgeScope} from '../core/knowledge-practice';
import type {KnowledgeCatalog} from '../core/knowledge-practice';
import { hasUiTranslation, initializeUiLanguage, showNotice, stateLabel, t } from './ui-language';
declare const __VV_BUILD_ID__: string;
document.documentElement.dataset.vvBuild = __VV_BUILD_ID__;
document.querySelector('#extension-version')!.textContent = `v${chrome.runtime.getManifest().version}`;

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
  model_call_limit?:number;
}

const POPUP_PREFERENCES_KEY = "vv-popup-preferences";

const manager = new ProviderManager(new ChromeLocalStore());
document.querySelector("#open-tasks")!.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("tasks.html") });
});
const providerSelect = document.querySelector<HTMLSelectElement>("#provider")!;
const modelSelect = document.querySelector<HTMLSelectElement>("#model")!;
const callLimit = document.querySelector<HTMLInputElement>("#call-limit")!;
const inputMode = document.querySelector<HTMLInputElement>("#input-mode")!;
const modeSlider = document.querySelector<HTMLElement>("#mode-slider")!;
const inputModeTitle = document.querySelector<HTMLElement>("#input-mode-title")!;
const inputModeDescription = document.querySelector<HTMLElement>("#input-mode-description")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear")!;
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
let displayedSnapshot:SessionRuntimeSnapshot|null=null;
let displayedError='';
let previewGeneration=0;
let preparationId:string|undefined;
let preparing=false;
interface CoursePreparationView {preparation_id:string;catalog?:CourseCatalog;provider_profile_id:string;model_id:string;model_calls:{used:number;limit:number};loaded:number;title:string;phase:'loading'|'ready'|'paused';notice:string|null}
const courseRange = document.querySelector<HTMLSelectElement>('#course-range')!;
const courseStart = document.querySelector<HTMLButtonElement>('#start-course')!;
const coursePreview = document.querySelector<HTMLElement>('#course-preview')!;
function courseScope():string[] {
  if(knowledgeCatalog&&courseRange.value)return knowledgeCatalog.points.filter(p=>courseRange.value==='all'||courseRange.value==='point:'+p.id).map(p=>p.id);
  if(!courseCatalog||!courseRange.value)return [];
  return courseScopeForSelection(courseCatalog,courseRange.value);
}
function renderCourseScope():void {
  const ids=courseScope();const container=document.querySelector('#course-tasks')!;container.replaceChildren();
  for(const task of courseCatalog?.tasks.filter(t=>ids.includes(t.id))??[]){const p=document.createElement('p');p.textContent=`${task.title} · ${stateLabel(task.kind)} · ${stateLabel(task.status)}`;container.append(p);}
  for(const point of knowledgeCatalog?.points.filter(p=>ids.includes(p.id))??[]){const p=document.createElement('p');p.textContent=point.title+' · '+t('练习记录进入后逐项核对');container.append(p);}
  courseStart.disabled=ids.length===0||hasLiveSession;
}
courseRange.addEventListener('change',()=>{renderCourseScope();if(preparationId)void chrome.storage.local.set({['vv-course-scope:'+preparationId]:courseRange.value}).catch(error=>setError(error.message));});
function setPreparing(value:boolean):void{
  preparing=value;providerSelect.disabled=value;modelSelect.disabled=value;callLimit.disabled=value;
  document.querySelector<HTMLButtonElement>('#preview-course')!.disabled=value;
  document.querySelector<HTMLButtonElement>('#preview-practices')!.disabled=value;
  renderSession(displayedSnapshot);
}
function showPreparation(prepared:CoursePreparationView,range='all'):void{
  if(prepared.provider_profile_id!==providerSelect.value||prepared.model_id!==modelSelect.value||prepared.model_calls.limit!==Number(callLimit.value))return;
  if(!prepared.catalog){
    coursePreview.textContent=t('正在加载课程：{{count}}个课时 · 调用 {{used}}/{{limit}}',{count:prepared.loaded,used:prepared.model_calls.used,limit:prepared.model_calls.limit});
    if(prepared.notice)showNotice(coursePreview,prepared.notice);
    return;
  }
  const catalog=prepared.catalog;if(!catalog.complete||catalog.diagnostics.length)throw new Error(catalog.diagnostics.join('；')||'目录不完整。');
  knowledgeCatalog=null;preparationId=prepared.preparation_id;courseCatalog=catalog;
  coursePreview.textContent=t('{{platform}} · {{title}} · {{count}}个已识别任务',{platform:t(catalog.platform==='chaoxing'?'学习通':'知到'),title:catalog.title,count:catalog.tasks.length})+` · ${prepared.model_calls.used}/${prepared.model_calls.limit}`;
  courseRange.replaceChildren();
  for(const [value,label] of [['all',t('全部未完成课时')],...[...new Set(catalog.tasks.map(task=>task.chapter_id))].map(id=>['chapter:'+id,t('章节 {{id}}',{id})]),...catalog.tasks.map(task=>['lesson:'+task.lesson_id,task.title])]){
    const option=document.createElement('option');option.value=value!;option.textContent=label!;courseRange.append(option);
  }
  if(![...courseRange.options].some(option=>option.value===range))throw new Error('保存的课程范围已改变，请重新选择范围。');
  courseRange.value=range;courseRange.disabled=false;renderCourseScope();
  document.querySelector<HTMLDetailsElement>('#course-mode')!.open=true;
}
async function refreshPreparation():Promise<void>{
  if(activeTabId===undefined||!activeTabUrl||!/(?:chaoxing|zhihuishu)\.com$/.test(new URL(activeTabUrl).hostname))return;
  const prepared=await send<CoursePreparationView|null>({type:'VV_GET_COURSE_PREPARATION',tab_id:activeTabId});
  if(!prepared||hasLiveSession)return;
  if(prepared.phase==='loading'){setPreparing(true);showPreparation(prepared);return;}
  if(preparing)setPreparing(false);
  if(!preparationId&&prepared.catalog){const stored=await chrome.storage.local.get('vv-course-scope:'+prepared.preparation_id),range=stored['vv-course-scope:'+prepared.preparation_id];if(range!==undefined&&typeof range!=='string')throw new Error('保存的课程范围无效。');showPreparation(prepared,range);}
  else if(!prepared.catalog&&prepared.notice)showNotice(coursePreview,prepared.notice);
}
function invalidatePreparation():void{
  previewGeneration++;preparationId=undefined;courseCatalog=null;knowledgeCatalog=null;courseRange.replaceChildren();courseRange.disabled=true;renderCourseScope();coursePreview.textContent=t('配置已改变，请重新加载课程。');
  if(preparing&&activeTabId!==undefined)void send({type:'VV_CANCEL_COURSE_PREPARATION',tab_id:activeTabId}).catch(error=>setError(error.message));
}
document.querySelector('#preview-course')!.addEventListener('click',()=>{
  const generation=++previewGeneration;
  setPreparing(true);
  void (async()=>{
    knowledgeCatalog=null;courseCatalog=null;courseRange.replaceChildren();courseRange.disabled=true;courseStart.disabled=true;
    renderCourseScope();coursePreview.textContent=t('正在加载课程目录…');
    if(activeTabId===undefined)throw new Error('没有当前课程标签页。');
    await requestCurrentWebsite(activeTabId);
    const limit=Number(callLimit.value);if(!Number.isInteger(limit)||limit<=0)throw new Error('调用上限必须为正整数。');
    const prepared=await send<CoursePreparationView>({type:'VV_PREPARE_COURSE',tab_id:activeTabId,provider_profile_id:providerSelect.value,model_id:modelSelect.value,model_call_limit:limit});
    if(generation!==previewGeneration)return;
    showPreparation(prepared);
  })().catch(error=>{if(generation===previewGeneration)showNotice(coursePreview,String(error.message||error));}).finally(()=>setPreparing(false));
});
document.querySelector('#preview-practices')!.addEventListener('click',()=>{
  const generation=++previewGeneration;
  void(async()=>{
    knowledgeCatalog=null;courseCatalog=null;courseRange.replaceChildren();courseRange.disabled=true;courseStart.disabled=true;renderCourseScope();
    if(activeTabId===undefined)throw new Error('请进入知到知识点目录。');await requestCurrentWebsite(activeTabId);
    const catalog=await send<KnowledgeCatalog>({type:'VV_PREVIEW_PRACTICES',tab_id:activeTabId});if(generation!==previewGeneration)return;knowledgeCatalog=catalog;
    coursePreview.textContent=t('知到 · {{count}}个已加载知识点；本范围仅核对关联练习，不代表整个课程目录完整。',{count:catalog.points.length});
    for(const [value,label] of [['','请选择练习范围'],['all','当前已加载知识点的首次练习'],...catalog.points.map(p=>['point:'+p.id,p.title])]){
      const option=document.createElement('option');option.value=value!;option.textContent=hasUiTranslation(label!)?t(label!):label!;courseRange.append(option);
    }
    courseRange.value='all';courseRange.disabled=false;renderCourseScope();
  })().catch(error=>{if(generation===previewGeneration)showNotice(coursePreview,String(error.message||error));});
});
courseStart.addEventListener('click',()=>{
  void (async()=>{
    if((!courseCatalog&&!knowledgeCatalog)||activeTabId===undefined)throw new Error('请先读取并选择课程范围。');
    const scope=courseScope();if(knowledgeCatalog)validateKnowledgeScope(knowledgeCatalog,scope);else validateCourseScope(courseCatalog!,scope);
    const profile=profiles.find(p=>p.provider_profile_id===providerSelect.value);if(!profile)throw new Error('请先配置Provider。');
    const model=modelSelect.value;if(!profile.model_catalog.models.includes(model))throw new Error('请在上方选择当前Provider的模型。');
    const limit=Number(callLimit.value);if(!Number.isInteger(limit)||limit<=0)throw new Error('调用上限必须为正整数。');
    await requestCurrentWebsite(activeTabId);
    const snapshot=await send<SessionRuntimeSnapshot>({type:'VV_START_SESSION',tab_id:activeTabId,provider_profile_id:profile.provider_profile_id,model_id:model,
      ...(!knowledgeCatalog&&preparationId?{preparation_id:preparationId}:{}),
      strategy:'unattended',model_call_limit:limit,observation_input_mode:'structured',
      ...(knowledgeCatalog?{practice_course:{catalog:knowledgeCatalog,scope}}:{course:{course_id:courseCatalog!.course_id,platform:courseCatalog!.platform,scope,revision:courseCatalog!.revision}})});
    displayedError='';renderSession(snapshot);
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
  inputModeTitle.textContent = t(selected.title);
  inputModeDescription.textContent = t(selected.description);
}

function snapInputMode(): void {
  modeSlider.classList.remove("is-dragging");
  inputMode.value = String(Math.round(Number(inputMode.value)));
  renderInputMode();
  void savePreferences();
}

function setError(message: string): void {
  displayedError=message;
  statusText.textContent = t("需要处理");
  statusText.dataset.kind = "error";
  showNotice(detailText,message);
}

function sitePattern(urlValue: string): string {
  const url = new URL(urlValue);
  return `${url.origin}/*`;
}

async function tabSitePermissionOrigins(tabId: number, fallbackUrl: string): Promise<string[]> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return [...new Set(
    [fallbackUrl, ...(frames?.filter(activeWebsiteFrame).map((frame) => frame.url) ?? [])]
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
}

async function loadPreferences(): Promise<PopupPreferences> {
  const result = await chrome.storage.local.get(POPUP_PREFERENCES_KEY);
  const preferences = result[POPUP_PREFERENCES_KEY];
  if (!preferences || typeof preferences !== "object") return {};
  const migrated = { ...preferences, strategy: 'unattended' } satisfies PopupPreferences;
  await chrome.storage.local.set({ [POPUP_PREFERENCES_KEY]: migrated });
  return migrated;
}

async function savePreferences(): Promise<void> {
  await chrome.storage.local.set({
    [POPUP_PREFERENCES_KEY]: {
      provider_profile_id: providerSelect.value,
      model_id: modelSelect.value,
      strategy: 'unattended',
      observation_input_mode: selectedInputMode(),
      model_call_limit:Number(callLimit.value),
    } satisfies PopupPreferences,
  });
}

function renderSession(snapshot: SessionRuntimeSnapshot | null): void {
  displayedSnapshot=snapshot;
  hasLiveSession=Boolean(snapshot&&!['COMPLETE','CANCELLED','FAILED'].includes(snapshot.state));
  const active = snapshot && !["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(snapshot.state);
  statusText.dataset.kind = snapshot?.state === "FAILED" ? "error" : snapshot?.state === "PAUSED" ? "warning" : "";
  statusText.textContent = snapshot ? stateLabel(snapshot.state) : t("未启动");
  showNotice(detailText,snapshot?.notice ?? "打开一个逐题测验后启动。");
  progressText.textContent = snapshot
    ? t('已答 {{answered}} · 猜答 {{guessed}} · 重试 {{retried}} · 调用 {{used}}/{{limit}}',{...snapshot.progress,used:snapshot.model_calls.used,limit:snapshot.model_calls.limit})
    : "";
  if(snapshot?.course){
    const current=snapshot.course.checkpoint?.children.find(task=>task.id===snapshot.course!.current_task_id)??snapshot.course.tasks.find(task=>task.id===snapshot.course!.current_task_id);
    const courseInfo=`${snapshot.course.title} · ${stateLabel(snapshot.course.phase)}\n`+
      t('预计剩余播放时间：{{estimate}}{{frozen}}；不含答题、缓冲及平台同步耗时。',{estimate:snapshot.course.estimate_seconds===null?t('暂无法估计'):t('{{seconds}}秒',{seconds:snapshot.course.estimate_seconds}),frozen:snapshot.course.estimate_frozen?t('（冻结）'):''});
    detailText.append(document.createTextNode('\n'+courseInfo));
    if(current)detailText.append(document.createTextNode('\n'+t('当前资源：{{title}}',{title:current.title})));
    if(snapshot.course.video.rate!==undefined)detailText.append(document.createTextNode('\n'+t('实际倍速 {{rate}}x · 速度由外部插件设置',{rate:snapshot.course.video.rate??t('未确认')})));
    for(const issue of snapshot.course.issues??[])detailText.append(document.createTextNode(`\n${issue.title} · ${issue.reason}`));
    for(const result of snapshot.course.results)detailText.append(document.createTextNode('\n'+t('测验结果 {{score}} · 提交 {{submission}} · 及格 {{passed}}',{score:result.result.visible_score??t('未提供'),submission:t(result.result.submission_confirmed?'已确认':'未确认'),passed:t(result.result.passed===true?'已确认':result.result.passed===false?'未通过':'未提供')})));
  }
  if(snapshot?.practice){
    const results=snapshot.practice.results;
    detailText.append(document.createTextNode('\n'+[snapshot.practice.title+' · '+stateLabel(snapshot.practice.phase),
      ...results.map(r=>`${r.title}：${r.status==='submitted'?t('本次已提交 {{score}}',{score:r.score??t('结果已确认')}):t(r.status==='existing_record'?'已有作答记录，未重做':'页面明确免考／无练习')}`),
      t('本范围不包含视频、文档或期末考试；提交成功不等同于及格。')].join('\n')));
    progressText.textContent=t('知识点 {{checked}}/{{total}} 已核对 · 新提交 {{submitted}} · 调用 {{used}}/{{limit}}',{checked:results.length,total:snapshot.practice.scope.length,submitted:results.filter(r=>r.status==='submitted').length,used:snapshot.model_calls.used,limit:snapshot.model_calls.limit});
  }
  courseStart.disabled=hasLiveSession||courseScope().length===0;
  startButton.disabled = Boolean(snapshot && !["COMPLETE", "CANCELLED", "FAILED"].includes(snapshot.state));
  inputMode.disabled = Boolean(snapshot && !["COMPLETE", "CANCELLED", "FAILED"].includes(snapshot.state));
  pauseButton.disabled = !active&&!preparing;
  resumeButton.disabled = snapshot?.state !== "PAUSED" || snapshot.notice?.includes('请核对已保存作答和提交结果后再重新启动')===true;
  stopButton.disabled = !preparing&&(!snapshot || ["COMPLETE", "CANCELLED", "FAILED"].includes(snapshot.state));
  clearButton.disabled = !snapshot || !["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(snapshot.state);
  if (snapshot) {
    const modeIndex = INPUT_MODES.findIndex((item) => item.value === snapshot.observation_input_mode);
    if (modeIndex >= 0) inputMode.value = String(modeIndex);
    renderInputMode();
  }
}

async function refreshSession(): Promise<void> {
  if (activeTabId === undefined) return;
  try {
    const error=displayedError;
    renderSession(await send<SessionRuntimeSnapshot | null>({ type: "VV_GET_SESSION", tab_id: activeTabId }));
    if(error)setError(error);
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
  if(preferences.model_call_limit&&Number.isInteger(preferences.model_call_limit)&&preferences.model_call_limit>0)callLimit.value=String(preferences.model_call_limit);
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
  const modeIndex = INPUT_MODES.findIndex((item) => item.value === preferences.observation_input_mode);
  inputMode.value = String(modeIndex >= 0 ? modeIndex : 1);
  renderInputMode();

  if (profiles.length === 0) {
    setError("请先在设置中添加 Provider。");
    startButton.disabled = true;
    return;
  }

  if (activeTabId === undefined || !activeTabUrl?.startsWith("http")) {
    setError("当前页面需要使用可授权的 HTTP/HTTPS 测验网页。");
    startButton.disabled = true;
    return;
  }
  port = chrome.runtime.connect({ name: "vv-control" });
  port.postMessage({ tab_id: activeTabId });
  await refreshSession();
  await refreshPreparation();
  window.setInterval(()=>{if(preparing)void refreshPreparation().catch(error=>setError(error.message));},1000);
  window.setInterval(() => void refreshSession(), 750);
}

providerSelect.addEventListener("change", () => {
  invalidatePreparation();
  renderModels();
  void savePreferences();
});
modelSelect.addEventListener("change", () => { invalidatePreparation();void savePreferences(); });
callLimit.addEventListener('change',()=>{invalidatePreparation();void savePreferences();});
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
      strategy: 'unattended',
      model_call_limit: limit,
      observation_input_mode: selectedInputMode(),
      allow_native_search: supportsNativeSearch(profiles.find(p => p.provider_profile_id === providerSelect.value)!, modelSelect.value),
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
    displayedError='';renderSession(snapshot);
  } catch (error) {
    setError(error instanceof Error ? error.message : "启动失败。");
  }
});

pauseButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  if(preparing){await send({type:'VV_CANCEL_COURSE_PREPARATION',tab_id:activeTabId});return;}
  try {const snapshot=await send<SessionRuntimeSnapshot>({ type: "VV_PAUSE_SESSION", tab_id: activeTabId });displayedError='';renderSession(snapshot);}
  catch(error){setError(error instanceof Error?error.message:'暂停失败。');}
});
resumeButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  try {
    await requestCurrentWebsite(activeTabId);
    const snapshot=await send<SessionRuntimeSnapshot>({ type: "VV_RESUME_SESSION", tab_id: activeTabId });displayedError='';renderSession(snapshot);
  } catch (error) { setError(error instanceof Error ? error.message : "恢复失败。"); }
});
stopButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  if(preparing){await send({type:'VV_CANCEL_COURSE_PREPARATION',tab_id:activeTabId});return;}
  try {const snapshot=await send<SessionRuntimeSnapshot>({ type: "VV_STOP_SESSION", tab_id: activeTabId });displayedError='';renderSession(snapshot);}
  catch(error){setError(error instanceof Error?error.message:'停止失败。');}
});
clearButton.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  try {await send({ type: "VV_CLEAR_SESSION", tab_id: activeTabId });displayedError='';renderSession(null);}
  catch(error){setError(error instanceof Error?error.message:'清除失败。');}
});

void initializeUiLanguage(()=>{
  const error=displayedError;
  renderInputMode();renderSession(displayedSnapshot);renderCourseScope();
  if(error)setError(error);
  if(courseCatalog)coursePreview.textContent=t('{{platform}} · {{title}} · {{count}}个已识别任务',{platform:t(courseCatalog.platform==='chaoxing'?'学习通':'知到'),title:courseCatalog.title,count:courseCatalog.tasks.length});
  if(knowledgeCatalog)coursePreview.textContent=t('知到 · {{count}}个已加载知识点；本范围仅核对关联练习，不代表整个课程目录完整。',{count:knowledgeCatalog.points.length});
  for(const option of courseRange.options){
    if(option.value.startsWith('chapter:'))option.textContent=t('章节 {{id}}',{id:option.value.slice(8)});
    else if(option.value.startsWith('lesson:'))option.textContent=courseCatalog?.tasks.find(task=>task.lesson_id===option.value.slice(7))?.title??t('课时 {{id}}',{id:option.value.slice(7)});
    else if(!option.value)option.textContent=t(courseCatalog?'请选择范围':knowledgeCatalog?'请选择练习范围':'请先读取目录');
    else if(option.value==='all')option.textContent=t(knowledgeCatalog?'当前已加载知识点的首次练习':'全部未完成课时');
  }
}).then(initialize);
