export function websitePermissionOrigin(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    return ["http:", "https:"].includes(url.protocol) ? `${url.origin}/*` : null;
  } catch { return null; }
}

export function activeWebsiteFrame(frame: { documentLifecycle?: string }): boolean {
  return frame.documentLifecycle === undefined || frame.documentLifecycle === 'active';
}

export async function websiteIsAuthorized(url: string): Promise<boolean> {
  const origin = websitePermissionOrigin(url);
  return origin !== null && await chrome.permissions.contains({ origins: [origin] });
}

export async function requireCurrentWebsite(tabId: number, navigationUrl?: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  const url = navigationUrl ?? frame?.url ?? tab.url;
  if (!url || !await websiteIsAuthorized(url)) {
    throw new Error("当前网站尚未授权。请在 VV 中授予当前网站权限后再继续。");
  }
}

export async function requestCurrentWebsite(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const frames = (await chrome.webNavigation.getAllFrames({ tabId }))?.filter(activeWebsiteFrame);
  const url = frames?.find(frame => frame.frameId === 0)?.url ?? tab.url;
  const origin = url && websitePermissionOrigin(url);
  if (!origin) throw new Error("请先回到可使用 VV 的普通网站。");
  const origins = [...new Set([origin, ...(frames ?? []).map(frame => websitePermissionOrigin(frame.url)).filter((item): item is string => item !== null)])];
  if (!await chrome.permissions.contains({ origins }) && !await chrome.permissions.request({ origins })) {
    throw new Error("恢复前需要当前网站权限。");
  }
}
