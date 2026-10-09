import type { LocalKeyValueStore } from "../provider/provider-manager";

export class ChromeLocalStore implements LocalKeyValueStore {
  async exclusive<T>(operation:()=>Promise<T>):Promise<T>{return navigator.locks.request('vv-provider-config',operation);}
  async setMany(values:Record<string,unknown>):Promise<void>{await chrome.storage.local.set(values);}
  async get<T>(key: string): Promise<T | undefined> {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }
}
