import { providerProfileSchema } from "../core/schema";
import type { ProviderProfile } from "../core/schema";
import { providerBatchLimits } from './model-batch-policy';

function readProfile(value: ProviderProfile): ProviderProfile {
  const parsed = providerProfileSchema.parse(value);
  const { model_batch_limits, native_web_search_model_ids, ...profile } = parsed;
  return { ...profile, provider_batch_limits: providerBatchLimits(parsed) };
}

export interface LocalKeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  exclusive<T>(operation:()=>Promise<T>):Promise<T>;
  setMany(values:Record<string,unknown>):Promise<void>;
}

const PROFILE_INDEX_KEY = "provider-profile-index";
const profileKey = (id: string) => `provider-profile:${id}`;
const secretKey = (secretRef: string) => `provider-secret:${secretRef}`;

export interface ProviderProfileInput {
  profile: ProviderProfile;
  apiKey?: string;
  expected?: ProviderProfile;
}

export class ProviderInUseError extends Error {
  constructor(profileId: string) {
    super(`Provider profile ${profileId} is in use by an active session.`);
    this.name = "ProviderInUseError";
  }
}

export class ProviderManager {
  constructor(
    private readonly store: LocalKeyValueStore,
    private readonly isProfileActive: (profileId: string) => boolean = () => false,
  ) {}

  async list(): Promise<ProviderProfile[]> {
    const ids = (await this.store.get<string[]>(PROFILE_INDEX_KEY)) ?? [];
    const profiles = await Promise.all(ids.map((id) => this.store.get<ProviderProfile>(profileKey(id))));
    return profiles
      .filter((profile): profile is ProviderProfile => profile !== undefined)
      .map(readProfile);
  }

  async get(profileId: string): Promise<ProviderProfile | undefined> {
    const profile = await this.store.get<ProviderProfile>(profileKey(profileId));
    return profile ? readProfile(profile) : undefined;
  }

  async getApiKey(profile: ProviderProfile): Promise<string | undefined> {
    return this.store.get<string>(secretKey(profile.secret_ref));
  }

  async save(input: ProviderProfileInput): Promise<ProviderProfile> {
    return this.store.exclusive(async()=>{
    const profile = readProfile(input.profile);
    if(input.expected && JSON.stringify(await this.get(profile.provider_profile_id))!==JSON.stringify(input.expected))throw new Error('Provider configuration changed during this operation.');
    const ids = (await this.store.get<string[]>(PROFILE_INDEX_KEY)) ?? [];
    await this.store.setMany({[PROFILE_INDEX_KEY]:ids.includes(profile.provider_profile_id)?ids:[...ids,profile.provider_profile_id],
      [profileKey(profile.provider_profile_id)]:profile,...(input.apiKey!==undefined?{[secretKey(profile.secret_ref)]:input.apiKey}:{})});
    return profile;
    });
  }

  async delete(profileId: string): Promise<void> {
    await this.store.exclusive(async()=>{
    if (this.isProfileActive(profileId)) {
      throw new ProviderInUseError(profileId);
    }
    const profile = await this.get(profileId);
    if (!profile) return;
    const ids = (await this.store.get<string[]>(PROFILE_INDEX_KEY)) ?? [];
    await this.store.set(
      PROFILE_INDEX_KEY,
      ids.filter((id) => id !== profileId),
    );
    await this.store.remove(profileKey(profileId));
    await this.store.remove(secretKey(profile.secret_ref));
    });
  }

}

export class MemoryKeyValueStore implements LocalKeyValueStore {
  readonly values = new Map<string, unknown>();
  #pending:Promise<void>=Promise.resolve();
  async exclusive<T>(operation:()=>Promise<T>):Promise<T>{
    const previous=this.#pending;let release!:()=>void;
    this.#pending=new Promise<void>(resolve=>{release=resolve;});
    await previous;try{return await operation();}finally{release();}
  }
  async setMany(values:Record<string,unknown>):Promise<void>{for(const [key,value] of Object.entries(values))this.values.set(key,structuredClone(value));}

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }
}
