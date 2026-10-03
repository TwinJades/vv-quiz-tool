// Recorder state only; no browser actions or model calls.
export const recommendations = [
  { name: "H5P 逐题题组", url: "https://h5p.org/node/8777", detail: "文字、图片、单选、填空；此前整场未通过，不含多选。" },
  { name: "H5P 文字单选", url: "https://h5p.org/h5p/embed/1512", detail: "此前 Chrome/Edge 自动完成 3/3。" },
  { name: "H5P 图片多选", url: "https://h5p.org/h5p/embed/1249570", detail: "此前 Chrome/Edge 自动完成 4/4。" },
  { name: "H5P 填空", url: "https://h5p.org/h5p/embed/1039075", detail: "此前 Chrome/Edge 自动完成 5/5。" },
  { name: "W3Schools 测验目录", url: "https://www.w3schools.com/quiztest/", detail: "可自行挑选语言和题目；当前版本整场仍待验收。" },
  { name: "H5P 活动类型目录", url: "https://h5p.org/content-types-and-applications", detail: "自行寻找例题；拖拽、主观题等不属于 VV 当前支持范围。" },
];

export function correlateTabs(pages, tabs) {
  const matches = new Map();
  const claimed = new Set();
  for (const tab of tabs) {
    if (!tab.identity || !Number.isFinite(tab.identity.time_origin)) continue;
    const candidates = pages.filter(page => page.url === tab.identity.url && page.time_origin === tab.identity.time_origin);
    const peers = tabs.filter(other => other.identity?.url === tab.identity.url && other.identity?.time_origin === tab.identity.time_origin);
    if (candidates.length === 1 && peers.length === 1) {
      matches.set(tab.id, candidates[0].id);
      claimed.add(candidates[0].id);
    }
  }
  for (const tab of tabs) {
    if (matches.has(tab.id) || !/^https?:/.test(tab.url || "")) continue;
    const candidates = pages.filter(page => page.url === tab.url);
    // Without document identity, duplicate URLs must remain unlinked.
    if (candidates.length === 1 && tabs.filter(other => other.url === tab.url).length === 1 && !claimed.has(candidates[0].id)) {
      matches.set(tab.id, candidates[0].id);
      claimed.add(candidates[0].id);
    }
  }
  return matches;
}

export function updateInventory(report, pages, tabs, at) {
  const events = [];
  const matches = correlateTabs(pages, tabs);
  const open = new Set(pages.map(page => page.id));
  for (const item of report.tabs) {
    if (!item.closed_at && !open.has(item.target_id)) {
      item.closed_at = at;
      events.push({ type: "tab_closed", target_id: item.target_id, tab_id: item.tab_id, url: item.url });
    }
  }
  for (const page of pages) {
    let item = report.tabs.find(tab => tab.target_id === page.id);
    if (!item) {
      item = { target_id: page.id, tab_id: null, window_id: null, url: page.url, title: page.title, opened_at: at, closed_at: null, navigation_history: [{ at, url: page.url }], screenshots: [], operator_note: "", website_result: null };
      report.tabs.push(item);
      events.push({ type: "tab_opened", target_id: page.id, url: page.url });
    } else if (item.url !== page.url || (item.time_origin && page.time_origin && item.time_origin !== page.time_origin)) {
      item.navigation_history.push({ at, url: page.url });
      events.push({ type: "tab_navigated", target_id: page.id, tab_id: item.tab_id, from_url: item.url, url: page.url });
    }
    Object.assign(item, { url: page.url, title: page.title, time_origin: page.time_origin, closed_at: null });
    const tab = tabs.find(tab => matches.get(tab.id) === page.id);
    Object.assign(item, { tab_id: tab?.id ?? null, window_id: tab?.window_id ?? null, active: tab?.active ?? false });
  }
  for (const tab of tabs) {
    const snapshot = tab.snapshot;
    if (!snapshot?.session_id) continue;
    const targetId = matches.get(tab.id) ?? null;
    const page = report.tabs.find(item => item.target_id === targetId);
    let session = report.sessions.find(item => item.session_id === snapshot.session_id);
    if (!session) {
      session = { session_id: snapshot.session_id, tab_id: tab.id, target_id: targetId, first_seen_at: at, first_seen_url: page?.url ?? tab.url ?? null, latest_snapshot: null, website_result: null, screenshots: [], operator_note: "" };
      report.sessions.push(session);
    }
    const changed = JSON.stringify(session.latest_snapshot) !== JSON.stringify(snapshot) || session.target_id !== targetId;
    Object.assign(session, { target_id: targetId, current_url: page?.url ?? tab.url ?? null, last_seen_at: at, latest_snapshot: snapshot });
    if (page) page.latest_session_id = session.session_id;
    if (changed) events.push({ type: "vv_state", target_id: targetId, tab_id: tab.id, session_id: session.session_id, url: session.current_url, snapshot });
  }
  return events;
}
