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
  it('retains both profiles when two managers save concurrently',async()=>{
    const store=new MemoryKeyValueStore(),first=new ProviderManager(store),second=new ProviderManager(store);
    const other={...profile,provider_profile_id:'provider_2',secret_ref:'secret_2'};
    await Promise.all([first.save({profile}),second.save({profile:other})]);
    expect((await first.list()).map(item=>item.provider_profile_id).sort()).toEqual(['provider_1','provider_2']);
  });
  it('rejects a stale refresh after a newer configuration has been saved',async()=>{
    const manager=new ProviderManager(new MemoryKeyValueStore());await manager.save({profile});
    const original=(await manager.get(profile.provider_profile_id))!;
    await manager.save({profile:{...original,display_name:'新名称'},expected:original});
    await expect(manager.save({profile:{...original,model_catalog:{...original.model_catalog,models:['new-model']}},expected:original})).rejects.toThrow('changed');
    expect((await manager.get(profile.provider_profile_id))?.display_name).toBe('新名称');
  });
  it("keeps API keys separate from stored profiles", async () => {
    const store = new MemoryKeyValueStore();
    const manager = new ProviderManager(store);
    await manager.save({ profile, apiKey: "private-key" });

    expect(await manager.list()).toEqual([{ ...profile, provider_batch_limits: { max_questions: 5, max_estimated_tokens: 12000, max_images: 4 } }]);
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
