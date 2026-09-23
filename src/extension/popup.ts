import type { ObservationInputMode, ProviderProfile, RunStrategy, SessionRuntimeSnapshot } from "../core";
import { ProviderManager } from "../provider/provider-manager";
import type { ExtensionRequest } from "./messages";
import { ChromeLocalStore } from "./storage";

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
const providerSelect = document.querySelector<HTMLSelectElement>("#provider")!;
const modelSelect = document.querySelector<HTMLSelectElement>("#model")!;
const strategySelect = document.querySelector<HTMLSelectElement>("#strategy")!;
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
const applyStrategyButton = document.querySelector<HTMLButtonElement>("#apply-strategy")!;
const statusText = document.querySelector<HTMLElement>("#session-status")!;
const detailText = document.querySelector<HTMLElement>("#session-detail")!;
const progressText = document.querySelector<HTMLElement>("#session-progress")!;
let profiles: ProviderProfile[] = [];
let activeTabId: number | undefined;
let activeTabUrl: string | undefined;
let port: chrome.runtime.Port | undefined;

const INPUT_MODES: Array<{ value: ObservationInputMode; title: string; description: string }> = [
  { value: "structured", title: "仅结构化数据", description: "只发送数据分离层提取的题干、选项和必要图片。" },
  { value: "semantic_snapshot", title: "首次快照", description: "首次发送清洗后的页面文本与控件，后续发送结构化题目；结构失效时重新校准。" },
  { value: "visual_snapshot", title: "允许加入截图", description: "再加入当前可见页面截图供模型解答与分离；需要 Provider 已授权图片输入。" },
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
  const active = snapshot && !["COMPLETE", "CANCELLED", "FAILED", "PAUSED"].includes(snapshot.state);
  statusText.dataset.kind = snapshot?.state === "FAILED" ? "error" : snapshot?.state === "PAUSED" ? "warning" : "";
  statusText.textContent = snapshot?.state ?? "未启动";
  detailText.textContent = snapshot?.notice ?? "打开一个逐题测验后启动。";
  progressText.textContent = snapshot
    ? `已答 ${snapshot.progress.answered} · 猜答 ${snapshot.progress.guessed} · 重试 ${snapshot.progress.retried} · 调用 ${snapshot.model_calls.used}/${snapshot.model_calls.limit}`
    : "";
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
  renderModels();
  void savePreferences();
});
modelSelect.addEventListener("change", () => void savePreferences());
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith("http")) {
    const origins = await tabSitePermissionOrigins(activeTabId, tab.url);
    const granted = await chrome.permissions.request({ origins });
    if (!granted) {
      setError("恢复前需要当前网站权限。");
      return;
    }
  }
  renderSession(await send({ type: "VV_RESUME_SESSION", tab_id: activeTabId }));
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
