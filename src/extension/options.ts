import { SCHEMA_VERSION, providerProfileSchema, modelBatchLimitsSchema } from "../core";
import { DEFAULT_BATCH_LIMITS } from "../core/batch-planner";
import { providerBatchLimits } from "../provider/model-batch-policy";
import type { BatchLimits } from "../core/batch-planner";
import type { ProviderProfile } from "../core";
import { listProviderModels } from "../provider/model-catalog";
import { ProviderManager } from "../provider/provider-manager";
import { ChromeLocalStore } from "./storage";
import { hasUiTranslation, initializeUiLanguage, showNotice, t } from './ui-language';

const manager = new ProviderManager(new ChromeLocalStore());
let busy=false;
function lockForm(value:boolean):void {
  busy=value;
  for(const control of document.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement|HTMLTextAreaElement>('input,button,select,textarea'))control.disabled=value;
  if(!value)renderSearchSupport();
}
const form = document.querySelector<HTMLFormElement>("#provider-form")!;
const profileId = document.querySelector<HTMLInputElement>("#profile-id")!;
const displayName = document.querySelector<HTMLInputElement>("#display-name")!;
const providerType = document.querySelector<HTMLSelectElement>("#provider-type")!;
const nativeSearch = document.querySelector<HTMLInputElement>("#native-search")!;
const baseUrl = document.querySelector<HTMLInputElement>("#base-url")!;
const apiKey = document.querySelector<HTMLInputElement>("#api-key")!;
const models = document.querySelector<HTMLTextAreaElement>("#models")!;
const imageInput = document.querySelector<HTMLInputElement>("#image-input")!;
const status = document.querySelector<HTMLElement>("#status")!;
const profileList = document.querySelector<HTMLElement>("#profile-list")!;
const batchQuestions = document.querySelector<HTMLInputElement>("#batch-questions")!;
const batchTokens = document.querySelector<HTMLInputElement>("#batch-tokens")!;
const batchImages = document.querySelector<HTMLInputElement>("#batch-images")!;
document.querySelector('#extension-version')!.textContent = `v${chrome.runtime.getManifest().version}`;

function readBatchLimits(): BatchLimits {
  return modelBatchLimitsSchema.parse({
    max_questions: Number(batchQuestions.value), max_estimated_tokens: Number(batchTokens.value), max_images: Number(batchImages.value),
  });
}

function showBatchLimits(limits: BatchLimits): void {
  batchQuestions.value = String(limits.max_questions);
  batchTokens.value = String(limits.max_estimated_tokens);
  batchImages.value = String(limits.max_images);
}

function renderSearchSupport(): void {
  nativeSearch.disabled = providerType.value === 'google';
  if (nativeSearch.disabled) nativeSearch.checked = false;
  document.querySelector('#search-support')!.textContent = nativeSearch.disabled
    ? t('当前 Google 原生接口尚未支持联网搜索。') : '';
}

let statusMessage = '';
let statusError = false;
function setStatus(message: string, error = false): void {
  statusMessage=message; statusError=error;
  if (error) showNotice(status,message);
  else { showNotice(status,''); status.textContent = hasUiTranslation(message) ? t(message) : message; }
  status.dataset.kind = error ? "error" : "success";
}

function originPattern(value: string): string {
  const url = new URL(value);
  return `${url.origin}/*`;
}

async function requestProviderPermission(value: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [originPattern(value)] });
}

function manualModels(): string[] {
  return [...new Set(models.value.split(/[\n,]/).map((model) => model.trim()).filter(Boolean))];
}

function resetForm(): void {
  form.reset();
  profileId.value = "";
  renderSearchSupport();
  showBatchLimits(DEFAULT_BATCH_LIMITS);
  setStatus("");
}

function loadIntoForm(profile: ProviderProfile): void {
  profileId.value = profile.provider_profile_id;
  displayName.value = profile.display_name;
  providerType.value = profile.provider_type;
  nativeSearch.checked = profile.capabilities.native_web_search;
  renderSearchSupport();
  baseUrl.value = profile.base_url;
  models.value = profile.model_catalog.models.join("\n");
  showBatchLimits(providerBatchLimits(profile));
  imageInput.checked = profile.capabilities.image_input && profile.image_upload_authorized;
  apiKey.value = "";
  setStatus("已载入配置；密钥留空表示保持原值。", false);
}

async function renderProfiles(): Promise<void> {
  const profiles = await manager.list();
  profileList.replaceChildren();
  if (profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = t("尚未配置 Provider。");
    profileList.append(empty);
    return;
  }
  for (const profile of profiles) {
    const item = document.createElement("article");
    item.className = "profile-card";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = profile.display_name;
    const endpoint = document.createElement("span");
    endpoint.textContent = t('{{url}} · {{count}} 个模型',{url:profile.base_url,count:profile.model_catalog.models.length});
    details.append(title, endpoint);

    const actions = document.createElement("div");
    actions.className = "row";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = t("编辑");
    edit.addEventListener("click", () => {if(!busy)loadIntoForm(profile);});
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = t("刷新模型");
    refresh.addEventListener("click", async () => {
      if(busy)return;lockForm(true);
      try {
        const granted = await requestProviderPermission(profile.base_url);
        if (!granted) throw new Error("未授予 Provider 网络权限。");
        const result = await listProviderModels(profile, await manager.getApiKey(profile));
        const updated = {
          ...profile,
          model_catalog: {
            source: result.source,
            models: result.models,
            refreshed_at: result.refreshed_at,
            ...(result.input_token_limits ? { input_token_limits: result.input_token_limits } : {}),
          },
        } satisfies ProviderProfile;
        await manager.save({ profile: updated,expected:profile });
        loadIntoForm(updated);
        await renderProfiles();
        setStatus(result.error ? '模型列表读取失败，保留手动列表。' : "模型列表已刷新。", Boolean(result.error));
        if (result.error) showNotice(status,result.error);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "刷新失败。", true);
      } finally {lockForm(false);}
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = t("删除");
    remove.addEventListener("click", async () => {
      if(busy)return;lockForm(true);
      try {
        const response = (await chrome.runtime.sendMessage({
          type: "VV_DELETE_PROVIDER",
          provider_profile_id: profile.provider_profile_id,
        })) as { ok: boolean; error?: string };
        if (!response.ok) throw new Error(response.error ?? "删除失败。");
        if (profileId.value === profile.provider_profile_id) resetForm();
        await renderProfiles();
        setStatus("Provider 及其本地密钥已删除。", false);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "删除失败。", true);
      } finally {lockForm(false);}
    });
    actions.append(edit, refresh, remove);
    item.append(details, actions);
    profileList.append(item);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if(busy)return;
  const fields={id:profileId.value,name:displayName.value.trim(),type:providerType.value,key:apiKey.value,images:imageInput.checked,search:!nativeSearch.disabled&&nativeSearch.checked};
  lockForm(true);
  try {
    const batchLimits = readBatchLimits();
    const normalizedBaseUrl = baseUrl.value.trim().replace(/\/$/, "");
    const configuredModels = manualModels();
    setStatus('正在请求 Provider 网络权限，请确认浏览器的授权提示。');
    const granted = await requestProviderPermission(normalizedBaseUrl);
    if (!granted) throw new Error("未授予该 Provider 的网络权限，配置未保存。");
    const existing = fields.id ? await manager.get(fields.id) : undefined;
    if(fields.id&&!existing)throw new Error('Provider configuration was removed during editing.');
    const id = existing?.provider_profile_id ?? crypto.randomUUID();
    const draftProfile = providerProfileSchema.parse({
      schema_version: SCHEMA_VERSION,
      provider_profile_id: id,
      display_name: fields.name,
      provider_type: fields.type,
      base_url: normalizedBaseUrl,
      secret_ref: existing?.secret_ref ?? `secret_${crypto.randomUUID()}`,
      model_catalog: { source: "manual", models: configuredModels, refreshed_at: null,
        ...(existing?.provider_type === fields.type && existing?.base_url === normalizedBaseUrl && existing?.model_catalog.input_token_limits
          ? { input_token_limits: existing.model_catalog.input_token_limits } : {}) },
      capabilities: {
        image_input: fields.images,
        structured_output: true,
        native_web_search: fields.search,
      },
      image_upload_authorized: fields.images,
      provider_batch_limits: batchLimits,
    });
    const effectiveApiKey = fields.key || (existing ? await manager.getApiKey(existing) : undefined);
    const catalog = await listProviderModels(draftProfile, effectiveApiKey);
    if (catalog.source === "manual" && configuredModels.length === 0) {
      throw new Error('Provider 未返回模型列表，请手动填写至少一个模型 ID。');
    }
    const profile = providerProfileSchema.parse({
      ...draftProfile,
      model_catalog: {
        source: catalog.source,
        models: catalog.source === "provider_api" ? catalog.models : configuredModels,
        refreshed_at: catalog.refreshed_at,
        ...(catalog.input_token_limits ? { input_token_limits: catalog.input_token_limits } : {}),
      },
    });
    await manager.save({ profile, ...(fields.key ? { apiKey: fields.key } : {}),...(existing?{expected:existing}:{}) });
    loadIntoForm(profile);
    await renderProfiles();
    setStatus(
      catalog.error
        ? 'Provider 已保存；模型列表自动读取失败。'
        : "Provider 与模型列表已保存在本机。",
      Boolean(catalog.error),
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "保存失败。", true);
  } finally {lockForm(false);}
});

document.querySelector("#new-profile")?.addEventListener("click", () => {if(!busy)resetForm();});
providerType.addEventListener("change", () => {
  nativeSearch.checked = false;
  renderSearchSupport();
  if (!profileId.value) baseUrl.value = providerType.value === "google"
    ? "https://generativelanguage.googleapis.com/v1beta" : providerType.value === "anthropic"
      ? "https://api.anthropic.com/v1" : "";
});

void initializeUiLanguage(async()=>{
  setStatus(statusMessage,statusError);
  renderSearchSupport();
  await renderProfiles();
});
