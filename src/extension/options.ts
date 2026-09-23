import { SCHEMA_VERSION, providerProfileSchema } from "../core";
import type { ProviderProfile } from "../core";
import { listProviderModels } from "../provider/model-catalog";
import { ProviderManager } from "../provider/provider-manager";
import { ChromeLocalStore } from "./storage";

const manager = new ProviderManager(new ChromeLocalStore());
const form = document.querySelector<HTMLFormElement>("#provider-form")!;
const profileId = document.querySelector<HTMLInputElement>("#profile-id")!;
const displayName = document.querySelector<HTMLInputElement>("#display-name")!;
const baseUrl = document.querySelector<HTMLInputElement>("#base-url")!;
const apiKey = document.querySelector<HTMLInputElement>("#api-key")!;
const models = document.querySelector<HTMLTextAreaElement>("#models")!;
const imageInput = document.querySelector<HTMLInputElement>("#image-input")!;
const imageAuthorization = document.querySelector<HTMLInputElement>("#image-authorization")!;
const status = document.querySelector<HTMLElement>("#status")!;
const profileList = document.querySelector<HTMLElement>("#profile-list")!;

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
  setStatus("");
}

function loadIntoForm(profile: ProviderProfile): void {
  profileId.value = profile.provider_profile_id;
  displayName.value = profile.display_name;
  baseUrl.value = profile.base_url;
  models.value = profile.model_catalog.models.join("\n");
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
      provider_type: "openai_compatible",
      base_url: normalizedBaseUrl,
      secret_ref: existing?.secret_ref ?? `secret_${crypto.randomUUID()}`,
      model_catalog: { source: "manual", models: configuredModels, refreshed_at: null },
      capabilities: {
        image_input: imageInput.checked,
        structured_output: true,
        native_web_search: false,
      },
      image_upload_authorized: imageAuthorization.checked,
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

void renderProfiles();
