import { SCHEMA_VERSION, providerProfileSchema, modelBatchLimitsSchema } from "../core";
import { DEFAULT_BATCH_LIMITS } from "../core/batch-planner";
import type { BatchLimits } from "../core/batch-planner";
import type { ProviderProfile } from "../core";
import { listProviderModels } from "../provider/model-catalog";
import { ProviderManager } from "../provider/provider-manager";
import { ChromeLocalStore } from "./storage";

const manager = new ProviderManager(new ChromeLocalStore());
const form = document.querySelector<HTMLFormElement>("#provider-form")!;
const profileId = document.querySelector<HTMLInputElement>("#profile-id")!;
const displayName = document.querySelector<HTMLInputElement>("#display-name")!;
const providerType = document.querySelector<HTMLSelectElement>("#provider-type")!;
const searchModels = document.querySelector<HTMLTextAreaElement>("#search-models")!;
const baseUrl = document.querySelector<HTMLInputElement>("#base-url")!;
const apiKey = document.querySelector<HTMLInputElement>("#api-key")!;
const models = document.querySelector<HTMLTextAreaElement>("#models")!;
const imageInput = document.querySelector<HTMLInputElement>("#image-input")!;
const imageAuthorization = document.querySelector<HTMLInputElement>("#image-authorization")!;
const status = document.querySelector<HTMLElement>("#status")!;
const profileList = document.querySelector<HTMLElement>("#profile-list")!;
const batchModel = document.querySelector<HTMLSelectElement>("#batch-model")!;
const batchCustom = document.querySelector<HTMLInputElement>("#batch-custom")!;
const batchQuestions = document.querySelector<HTMLInputElement>("#batch-questions")!;
const batchTokens = document.querySelector<HTMLInputElement>("#batch-tokens")!;
const batchImages = document.querySelector<HTMLInputElement>("#batch-images")!;
let batchDraft: Record<string, BatchLimits> = Object.create(null);
let batchEditingId = "";

function storeBatchDraft(): void {
  if (!batchEditingId) return;
  if (batchCustom.checked) batchDraft[batchEditingId] = modelBatchLimitsSchema.parse({
    max_questions: Number(batchQuestions.value), max_estimated_tokens: Number(batchTokens.value), max_images: Number(batchImages.value),
  });
  else delete batchDraft[batchEditingId];
}

function showBatchLimits(id: string): void {
  batchEditingId = id;
  const limits = batchDraft[id] ?? DEFAULT_BATCH_LIMITS;
  batchCustom.checked = Boolean(batchDraft[id]);
  batchCustom.disabled = !id;
  batchQuestions.value = String(limits.max_questions);
  batchTokens.value = String(limits.max_estimated_tokens);
  batchImages.value = String(limits.max_images);
  for (const input of [batchQuestions, batchTokens, batchImages]) input.disabled = !id || !batchCustom.checked;
}

function refreshBatchModels(): void {
  const ids = [...new Set([...manualModels(), ...Object.keys(batchDraft)])];
  batchModel.replaceChildren();
  for (const id of ids.length ? ids : [""]) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id || "先填写或读取模型列表";
    batchModel.append(option);
  }
  batchModel.value = ids.includes(batchEditingId) ? batchEditingId : ids[0] ?? "";
  showBatchLimits(batchModel.value);
}

batchCustom.addEventListener("change", () => {
  for (const input of [batchQuestions, batchTokens, batchImages]) input.disabled = !batchCustom.checked;
});
batchModel.addEventListener("change", () => {
  try { storeBatchDraft(); showBatchLimits(batchModel.value); }
  catch { batchModel.value = batchEditingId; setStatus("分批限制需填写范围内的整数，修改后再切换模型。", true); }
});
models.addEventListener("change", () => {
  try { storeBatchDraft(); refreshBatchModels(); }
  catch { setStatus("请先修正模型分批限制。", true); }
});

function setStatus(message: string, error = false): void {
  status.textContent = message;
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
  imageAuthorization.checked = false;
  searchModels.disabled = true;
  batchDraft = Object.create(null);
  batchEditingId = "";
  refreshBatchModels();
  setStatus("");
}

function loadIntoForm(profile: ProviderProfile): void {
  profileId.value = profile.provider_profile_id;
  displayName.value = profile.display_name;
  providerType.value = profile.provider_type;
  searchModels.value = (profile.native_web_search_model_ids ?? []).join("\n");
  searchModels.disabled = profile.provider_type !== "anthropic";
  baseUrl.value = profile.base_url;
  models.value = profile.model_catalog.models.join("\n");
  batchDraft = Object.assign(Object.create(null), structuredClone(profile.model_batch_limits ?? {}));
  batchEditingId = Object.keys(batchDraft)[0] ?? "";
  refreshBatchModels();
  imageInput.checked = profile.capabilities.image_input;
  imageAuthorization.checked = profile.image_upload_authorized;
  apiKey.value = "";
  setStatus("已载入配置；密钥留空表示保持原值。", false);
}

async function renderProfiles(): Promise<void> {
  const profiles = await manager.list();
  profileList.replaceChildren();
  if (profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "尚未配置 Provider。";
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
    endpoint.textContent = `${profile.base_url} · ${profile.model_catalog.models.length} 个模型`;
    details.append(title, endpoint);

    const actions = document.createElement("div");
    actions.className = "row";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "编辑";
    edit.addEventListener("click", () => loadIntoForm(profile));
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "刷新模型";
    refresh.addEventListener("click", async () => {
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
        await manager.save({ profile: updated });
        loadIntoForm(updated);
        await renderProfiles();
        setStatus(result.error ? `自动读取失败，保留手动列表：${result.error}` : "模型列表已刷新。", Boolean(result.error));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "刷新失败。", true);
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
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
      }
    });
    actions.append(edit, refresh, remove);
    item.append(details, actions);
    profileList.append(item);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    storeBatchDraft();
    const normalizedBaseUrl = baseUrl.value.trim().replace(/\/$/, "");
    const configuredModels = manualModels();
    const granted = await requestProviderPermission(normalizedBaseUrl);
    if (!granted) throw new Error("未授予该 Provider 的网络权限，配置未保存。");
    const existing = profileId.value ? await manager.get(profileId.value) : undefined;
    const id = existing?.provider_profile_id ?? crypto.randomUUID();
    const draftProfile = providerProfileSchema.parse({
      schema_version: SCHEMA_VERSION,
      provider_profile_id: id,
      display_name: displayName.value.trim(),
      provider_type: providerType.value,
      base_url: normalizedBaseUrl,
      secret_ref: existing?.secret_ref ?? `secret_${crypto.randomUUID()}`,
      model_catalog: { source: "manual", models: [...new Set([...configuredModels,
        ...(providerType.value === "anthropic" ? searchModels.value.split(/[\n,]/).map(id => id.trim()).filter(Boolean) : [])])], refreshed_at: null,
        ...(existing?.provider_type === providerType.value && existing?.base_url === normalizedBaseUrl && existing?.model_catalog.input_token_limits
          ? { input_token_limits: existing.model_catalog.input_token_limits } : {}) },
      capabilities: {
        image_input: imageInput.checked,
        structured_output: true,
        native_web_search: providerType.value === "anthropic" && searchModels.value.trim().length > 0,
      },
      image_upload_authorized: imageAuthorization.checked,
      model_batch_limits: batchDraft,
      ...(providerType.value === "anthropic" ? { native_web_search_model_ids: [...new Set(searchModels.value.split(/[\n,]/).map(id => id.trim()).filter(Boolean))] } : {}),
    });
    const effectiveApiKey = apiKey.value || (existing ? await manager.getApiKey(existing) : undefined);
    const catalog = await listProviderModels(draftProfile, effectiveApiKey);
    if (catalog.source === "manual" && configuredModels.length === 0) {
      throw new Error(`Provider 未返回模型列表，请手动填写至少一个模型 ID。${catalog.error ? ` ${catalog.error}` : ""}`);
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
    await manager.save({ profile, ...(apiKey.value ? { apiKey: apiKey.value } : {}) });
    loadIntoForm(profile);
    await renderProfiles();
    setStatus(
      catalog.error
        ? `Provider 已保存；自动读取模型失败，已使用手动列表：${catalog.error}`
        : "Provider 与模型列表已保存在本机。",
      Boolean(catalog.error),
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "保存失败。", true);
  }
});

document.querySelector("#new-profile")?.addEventListener("click", resetForm);
providerType.addEventListener("change", () => {
  searchModels.disabled = providerType.value !== "anthropic";
  searchModels.value = "";
  if (!profileId.value) baseUrl.value = providerType.value === "google"
    ? "https://generativelanguage.googleapis.com/v1beta" : providerType.value === "anthropic"
      ? "https://api.anthropic.com/v1" : "";
});

void renderProfiles();
