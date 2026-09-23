import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION } from "../../src/core";
import type { ProviderProfile } from "../../src/core";
import {
  MemoryKeyValueStore,
  ProviderInUseError,
  ProviderManager,
} from "../../src/provider/provider-manager";

const profile: ProviderProfile = {
  schema_version: SCHEMA_VERSION,
  provider_profile_id: "provider_1",
  display_name: "Local provider",
  provider_type: "openai_compatible",
  base_url: "http://localhost:11434/v1",
  secret_ref: "secret_1",
  model_catalog: { source: "manual", models: ["model-a"], refreshed_at: null },
  capabilities: { image_input: false, structured_output: true, native_web_search: false },
  image_upload_authorized: false,
};

describe("ProviderManager", () => {
  it("keeps API keys separate from stored profiles", async () => {
    const store = new MemoryKeyValueStore();
    const manager = new ProviderManager(store);
    await manager.save({ profile, apiKey: "private-key" });

    expect(await manager.list()).toEqual([profile]);
    expect(JSON.stringify(await manager.list())).not.toContain("private-key");
    expect(await manager.getApiKey(profile)).toBe("private-key");
  });

  it("deletes the separate secret with its profile", async () => {
    const manager = new ProviderManager(new MemoryKeyValueStore());
    await manager.save({ profile, apiKey: "private-key" });
    await manager.delete(profile.provider_profile_id);

    expect(await manager.list()).toEqual([]);
    expect(await manager.getApiKey(profile)).toBeUndefined();
  });

  it("does not delete a profile used by an active session", async () => {
    const manager = new ProviderManager(new MemoryKeyValueStore(), () => true);
    await manager.save({ profile, apiKey: "private-key" });

    await expect(manager.delete(profile.provider_profile_id)).rejects.toBeInstanceOf(ProviderInUseError);
  });
});
