import { providerProfileSchema } from "../core/schema";
import type { ProviderProfile } from "../core/schema";

export interface LocalKeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

const PROFILE_INDEX_KEY = "provider-profile-index";
const profileKey = (id: string) => `provider-profile:${id}`;
const secretKey = (secretRef: string) => `provider-secret:${secretRef}`;

export interface ProviderProfileInput {
  profile: ProviderProfile;
  apiKey?: string;
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
      .map((profile) => providerProfileSchema.parse(profile));
  }

  async get(profileId: string): Promise<ProviderProfile | undefined> {
    const profile = await this.store.get<ProviderProfile>(profileKey(profileId));
    return profile ? providerProfileSchema.parse(profile) : undefined;
  }

  async getApiKey(profile: ProviderProfile): Promise<string | undefined> {
    return this.store.get<string>(secretKey(profile.secret_ref));
  }

  async save(input: ProviderProfileInput): Promise<ProviderProfile> {
    const profile = providerProfileSchema.parse(input.profile);
    const ids = (await this.store.get<string[]>(PROFILE_INDEX_KEY)) ?? [];
    if (!ids.includes(profile.provider_profile_id)) {
      await this.store.set(PROFILE_INDEX_KEY, [...ids, profile.provider_profile_id]);
    }
    await this.store.set(profileKey(profile.provider_profile_id), profile);
    if (input.apiKey !== undefined) {
      await this.store.set(secretKey(profile.secret_ref), input.apiKey);
    }
    return profile;
  }

  async delete(profileId: string): Promise<void> {
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
  }

}

export class MemoryKeyValueStore implements LocalKeyValueStore {
  readonly values = new Map<string, unknown>();

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
