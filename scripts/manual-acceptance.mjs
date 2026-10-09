import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { resolve } from "node:path";
import { recommendations, updateInventory } from "./browser-acceptance-state.mjs";
import { readEasyCpaAcceptanceConfig } from './read-easycpa-acceptance-config.mjs';
import { providerProfileSchema } from '../src/core/schema.ts';

const root = resolve(import.meta.dirname, "..");
const runtime = resolve(root, ".browser-regression-runtime");
const fresh = process.argv.includes('--fresh');
const runStamp = new Date().toISOString().replaceAll(':', '-');
const readyConnectionPath = resolve(runtime, 'manual-ready-connection.json');
const readyConnection = !fresh && existsSync(readyConnectionPath) ? JSON.parse(await readFile(readyConnectionPath, 'utf8')) : null;
const browserPath = process.env.VV_TEST_BROWSER || resolve(runtime, "chrome-cft/chrome-win64/chrome.exe");
const previousProfile = resolve(runtime, "visible-retry-20260930");
const profilePath = process.env.VV_TEST_PROFILE || (fresh ? resolve(runtime, `manual-ready-${runStamp}`, 'profile') : readyConnection?.profile || (existsSync(previousProfile) ? previousProfile : resolve(runtime, "manual-acceptance-profile")));
const reportDirectory = resolve(runtime, "manual-reports", runStamp);
const defaultSite = "https://h5p.org/node/8777";
const allowedModel = (model) => /^gemini-3\.(?:8|7)-flash(?:-|$)/.test(model) || /^gemini-3\.1-pro(?:-|$)/.test(model);
const modelPriority = (model) => model.startsWith("gemini-3.8-flash") ? 0 : model.startsWith("gemini-3.7-flash") ? 1 : 2;
const orderedAllowedModels = (models) => models.filter(allowedModel).sort((a, b) => modelPriority(a) - modelPriority(b) || a.localeCompare(b));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let attachPort = Number(process.argv.find(value => value.startsWith("--attach-port="))?.split("=")[1] || process.env.VV_TEST_CDP_PORT || 0);
const connectionPath = process.env.VV_MANUAL_CONNECTION_PATH || (fresh || readyConnection ? readyConnectionPath : resolve(runtime, "manual-recorder-connection.json"));
if (attachPort && (!Number.isInteger(attachPort) || attachPort < 1 || attachPort > 65535)) throw new Error("无效的浏览器调试端口");
let browser;
let controller;
let browserPort;
let dashboardUrl;
let polling = false;
let timer;
let stopping = false;
let connected = false;
let controllerTargetId;
let saveQueue = Promise.resolve();
let report = {
  schema: 2,
  scope: "browser",
  started_at: new Date().toISOString(),
  attached_to_existing_browser: Boolean(attachPort),
  browser: browserPath,
  profile: profilePath,
  extension_version: null,
  extension_build: null,
  available_allowed_models: [],
  tabs: [],
  sessions: [],
  legacy_report_directories: [],
  errors: [],
};

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.ready = new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error("浏览器调试连接超时")), 5000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolveReady(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); rejectReady(new Error("浏览器调试连接失败")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error("浏览器调试连接已关闭")); }
      this.pending.clear();
    });
  }
  async send(method, params = {}) {
    await this.ready;
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("浏览器调试连接已关闭");
    const id = ++this.nextId;
    const answer = new Promise((resolveAnswer, rejectAnswer) => {
      const timeout = setTimeout(() => { this.pending.delete(id); rejectAnswer(new Error(`${method} 超时`)); }, 8000);
      this.pending.set(id, { resolve: resolveAnswer, reject: rejectAnswer, timeout });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return answer;
  }
  async evaluate(expression) {
    const answer = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description || answer.exceptionDetails.text);
    return answer.result.value;
  }
  close() { this.socket.close(); }
}

async function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createTcpServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

async function cdpGet(path, method = "GET") {
  const response = await fetch(`http://127.0.0.1:${browserPort}${path}`, { method, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`浏览器调试接口 ${response.status}: ${path}`);
  return response.json();
}

function saveReport(event) {
  const serializedReport = JSON.stringify(report, null, 2) + "\n";
  const serializedEvent = event ? JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n" : null;
  saveQueue = saveQueue.then(async () => {
    await writeFile(resolve(reportDirectory, "report.json"), serializedReport, "utf8");
    if (serializedEvent) {
      const path = resolve(reportDirectory, "events.jsonl");
      const { appendFile } = await import("node:fs/promises");
      await appendFile(path, serializedEvent, "utf8");
    }
  });
  return saveQueue;
}

async function extensionId() {
  try {
    const preferences = JSON.parse(await readFile(resolve(profilePath, "Default/Secure Preferences"), "utf8"));
    const entry = Object.entries(preferences.extensions?.settings || {}).find(([, settings]) => settings.path && resolve(settings.path).toLowerCase() === resolve(root, "dist").toLowerCase());
    if (entry) return entry[0];
  } catch {}
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const targets = await cdpGet("/json/list");
    const workers = targets.filter((target) => target.type === "service_worker" && target.url.startsWith("chrome-extension://") && target.url.endsWith("/background.js"));
    for (const worker of workers) {
      const client = new Cdp(worker.webSocketDebuggerUrl);
      try {
        // Chromium component extensions may also use /background.js.
        const name = await client.evaluate("chrome.runtime.getManifest().name");
        if (name === "VV 自动答题工具") return new URL(worker.url).host;
      } catch {} finally { client.close(); }
    }
    await sleep(200);
  }
  const directory = resolve(profilePath, "Default/Local Extension Settings");
  const ids = existsSync(directory) ? (await readdir(directory, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name) : [];
  if (ids.length === 1) return ids[0];
  throw new Error("没有找到 VV 扩展。请确认 Chrome for Testing 能加载本项目的 dist 扩展。");
}

async function extEval(body) {
  if (!controller) throw new Error("VV 扩展连接未建立");
  return controller.evaluate(`(async()=>{${body}})()`);
}

async function pageOperation(targetId, operation) {
  const target = (await cdpGet("/json/list")).find(item => item.id === targetId && item.type === "page");
  if (!target || !/^https?:/.test(target.url)) throw new Error("网页标签已关闭或不再是 HTTP/HTTPS 网站");
  const page = new Cdp(target.webSocketDebuggerUrl);
  try { return await operation(page); } finally { page.close(); }
}

async function resultFromPage(targetId) {
  return pageOperation(targetId, page => page.evaluate(`(()=>{
    const documents=[document];for(const frame of document.querySelectorAll('iframe')){try{if(frame.contentDocument)documents.push(frame.contentDocument)}catch{}}
    const lines=documents.flatMap(doc=>(doc.body?.innerText||'').split(/\\n/).map(x=>x.trim())).filter(x=>x&&/(score|correct|result|points|得分|正确|成绩|\\d+\\s*\\/\\s*\\d+)/i.test(x)).slice(-20);
    return {url:location.href,title:document.title,score_lines:lines,captured_at:new Date().toISOString()};
  })()`));
}

async function captureScreenshot(targetId) {
  return pageOperation(targetId, async page => {
    await page.send("Page.enable");
    // Background tabs may have no rendered surface. The user's save action
    // explicitly selects this page; show it before capturing that page's pixels.
    await page.send("Page.bringToFront");
    const image = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = resolve(reportDirectory, `website-${targetId}-${Date.now()}.png`);
    await writeFile(file, Buffer.from(image.data, "base64"));
    return file;
  });
}

async function recordError(error, context = {}) {
  const message = String(error?.message || error);
  if (report.errors.at(-1) !== message) {
    report.errors.push(message);
    await saveReport({ type: "recorder_error", message, ...context });
  }
}

async function poll() {
  if (polling || !controller || stopping) return;
  polling = true;
  try {
    const allTargets = await cdpGet("/json/list");
    if (controllerTargetId && !allTargets.some(item => item.id === controllerTargetId)) throw new Error("记录专用 VV 设置标签已关闭，请停止记录后重新连接");
    const targets = allTargets.filter(item => item.type === "page" && /^https?:/.test(item.url) && item.url !== dashboardUrl && item.title !== "VV 人工验收记录");
    const pages = await Promise.all(targets.map(async target => {
      const page = new Cdp(target.webSocketDebuggerUrl);
      try {
        const identity = await page.evaluate("({url:location.href,title:document.title,time_origin:performance.timeOrigin})");
        return { id: target.id, ...identity };
      } catch { return { id: target.id, url: target.url, title: target.title }; }
      finally { page.close(); }
    }));
    const tabs = await extEval(`
      const tabs=await chrome.tabs.query({});
      return Promise.all(tabs.map(async tab=>{
        let snapshot=null,identity=null,error=null;
        try{const answer=await chrome.runtime.sendMessage({type:"VV_GET_SESSION",tab_id:tab.id});if(answer?.ok)snapshot=answer.result;else error=answer?.error||"无法读取会话";}catch(e){error=String(e.message||e)}
        if(snapshot||/^https?:/.test(tab.url||""))try{
          const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:()=>({url:location.href,time_origin:performance.timeOrigin})});identity=result?.result;
        }catch{}
        return {id:tab.id,window_id:tab.windowId,active:tab.active,url:tab.url,title:tab.title,snapshot,identity,error};
      }));`);
    connected = true;
    const events = updateInventory(report, pages, tabs, new Date().toISOString());
    for (const tab of tabs) if (tab.error) await recordError(tab.error, { tab_id: tab.id });
    for (const event of events) {
      await saveReport(event);
      if (event.type === "vv_state") {
        if (!allowedModel(event.snapshot.model_id)) await recordError(`检测到未获授权的模型：${event.snapshot.model_id}`, { session_id: event.session_id });
        if (event.target_id && ["COMPLETE", "PAUSED", "FAILED", "CANCELLED"].includes(event.snapshot.state)) {
          try {
            const result = await resultFromPage(event.target_id);
            report.sessions.find(item => item.session_id === event.session_id).website_result = result;
            await saveReport({ type: "website_result", target_id: event.target_id, tab_id: event.tab_id, session_id: event.session_id, result });
          } catch (error) { await recordError(error, { target_id: event.target_id }); }
        }
      }
    }
    // Keep active flags and titles current even when no VV state changed.
    await saveReport();
  } catch (error) { connected = false; await recordError(error); }
  finally { polling = false; }
}

async function openSite(urlText) {
  if (!connected) throw new Error("浏览器记录连接未就绪");
  const parsed = new URL(urlText);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("只允许 HTTP/HTTPS 测试网站");
  const target = await cdpGet(`/json/new?${encodeURIComponent(parsed.href)}`, "PUT");
  await saveReport({ type: "operator_open_site", target_id: target.id, url: parsed.href });
  return parsed.href;
}

async function stopRecorder() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  while (polling) await sleep(100);
  report.stopped_at = new Date().toISOString();
  await saveReport({ type: "recorder_stopped" });
  controller?.close();
  server.close();
  console.log("记录已停止并保存。浏览器保持打开。");
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 20_000) throw new Error("请求过大");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  const send = (status, body, type = "application/json; charset=utf-8") => {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  try {
    if (request.method === "POST" && ((request.headers.origin && request.headers.origin !== dashboardUrl?.slice(0, -1)) || request.headers["sec-fetch-site"] === "cross-site")) return send(403, { error: "只接受记录页的操作" });
    if (request.method === "GET" && request.url === "/") return send(200, await readFile(resolve(root, "scripts/manual-acceptance.html"), "utf8"), "text/html; charset=utf-8");
    if (request.method === "GET" && request.url === "/api/status") return send(200, { report, report_directory: reportDirectory, recommendations, ready: connected && !stopping });
    if (request.method === "POST" && request.url === "/api/site") return send(200, { url: await openSite((await readBody(request)).url) });
    if (request.method === "POST" && request.url === "/api/stop") {
      send(200, { message: "正在保存并停止记录，浏览器保持打开" });
      void stopRecorder();
      return;
    }
    if (request.method === "POST" && request.url === "/api/save") {
      const body = await readBody(request);
      const tab = report.tabs.find(item => item.target_id === body.target_id && !item.closed_at);
      if (!tab) throw new Error("请选择仍然打开的网站标签");
      const session = body.session_id ? report.sessions.find(item => item.session_id === body.session_id && item.target_id === tab.target_id) : null;
      if (body.session_id && !session) throw new Error("该会话不属于所选网站标签");
      const item = session || tab;
      item.operator_note = String(body.note || "").slice(0, 3000);
      item.website_result = await resultFromPage(tab.target_id);
      const screenshot = body.screenshot ? await captureScreenshot(tab.target_id) : null;
      if (screenshot) item.screenshots.push(screenshot);
      await saveReport({ type: "operator_save", target_id: tab.target_id, tab_id: tab.tab_id, session_id: session?.session_id ?? null, mode: session ? "vv_session_observed" : "manual_site_only", note: item.operator_note, result: item.website_result, screenshot });
      return send(200, { report_directory: reportDirectory, report });
    }
    send(404, { error: "Not found" });
  } catch (error) { send(400, { error: String(error?.message || error) }); }
});

async function main() {
  if (fresh && attachPort) throw new Error('全新验收不能同时接入已有浏览器。');
  if (!fresh && !attachPort) {
    try {
      const previous = JSON.parse(await readFile(connectionPath, "utf8"));
      if (previous.profile === profilePath && Number.isInteger(previous.cdp_port)) {
        browserPort = previous.cdp_port;
        const version = await cdpGet("/json/version");
        if (version.webSocketDebuggerUrl === previous.browser_websocket) {
          attachPort = previous.cdp_port;
          report.attached_to_existing_browser = true;
          try {
            const status = await (await fetch(`${previous.dashboard_url}api/status`, { signal: AbortSignal.timeout(2000) })).json();
            if (status.ready && status.report.schema === 2) {
              await cdpGet(`/json/new?${encodeURIComponent(previous.dashboard_url)}`, "PUT");
              console.log(`现有整浏览器记录程序正在运行：${previous.dashboard_url}`);
              console.log(`记录目录：${status.report_directory}`);
              return;
            }
          } catch {}
        }
      }
    } catch {}
  }
  if (!attachPort) {
    if (!existsSync(browserPath)) throw new Error(`找不到 Chrome for Testing：${browserPath}`);
    if (!existsSync(resolve(root, "node_modules"))) throw new Error("缺少 node_modules；请先运行 pnpm install --frozen-lockfile");
    const build = spawnSync(process.execPath, [resolve(root, "scripts/build.mjs")], { cwd: root,env:{...process.env,VV_BUILD_DIR:resolve(root,'dist'),VV_TEST_BUILD:'0'}, stdio: "inherit" });
    if (build.status !== 0) throw new Error("VV 构建失败");
  }
  await mkdir(reportDirectory, { recursive: true });
  await mkdir(profilePath, { recursive: true });
  await saveReport({ type: "recorder_started" });
  await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  dashboardUrl = `http://127.0.0.1:${server.address().port}/`;
  browserPort = attachPort || await freePort();
  report.cdp_port = browserPort;
  report.dashboard_url = dashboardUrl;
  if (attachPort) {
    const reportsRoot = resolve(runtime, "manual-reports");
    for (const entry of await readdir(reportsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = resolve(reportsRoot, entry.name);
      try {
        const previous = JSON.parse(await readFile(resolve(directory, "report.json"), "utf8"));
        if (previous.profile === profilePath && (previous.schema === 1 || previous.cdp_port === browserPort) && directory !== reportDirectory) report.legacy_report_directories.push(directory);
      } catch {}
    }
  }
  if (!attachPort) {
  const args = [
    `--user-data-dir=${profilePath}`,
    `--remote-debugging-port=${browserPort}`,
    `--load-extension=${resolve(root, "dist")}`,
    `--disable-extensions-except=${resolve(root, "dist")}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "--enable-unsafe-extension-debugging",
    dashboardUrl,
  ];
  browser = spawn(browserPath, args, { cwd: root, stdio: "ignore", windowsHide: false, detached: true });
  browser.unref();
  browser.on("error", (error) => console.error("浏览器启动失败：", error));
  }
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { await cdpGet("/json/version"); ready = true; break; } catch { await sleep(200); }
  }
  if (!ready) throw new Error("浏览器没有开放本地调试接口；请检查是否已有同配置 Chrome 窗口占用");
  const id = await extensionId();
  const options = await cdpGet(`/json/new?${encodeURIComponent(`chrome-extension://${id}/options.html`)}`, "PUT");
  controller = new Cdp(options.webSocketDebuggerUrl);
  await controller.send("Runtime.enable");
  let optionsReady = false;
  let optionsUrl = options.url;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = await controller.evaluate("({url:location.href,ready:Boolean(globalThis.chrome?.storage?.local&&globalThis.chrome?.runtime?.id)})");
    optionsUrl = state.url;
    if (state.ready) { optionsReady = true; break; }
    if (optionsUrl.startsWith("chrome-error:")) break;
    await sleep(100);
  }
  if (!optionsReady) throw new Error(`VV 扩展设置页未加载：${optionsUrl}`);
  await controller.evaluate('document.title="VV 记录连接（请保留）"');
  report.controller_target_id = options.id;
  const expectedBuild = JSON.parse(await readFile(resolve(root, 'dist/build-info.json'), 'utf8'));
  const loadedBuild = await extEval(`const response=await fetch(chrome.runtime.getURL('build-info.json'));if(!response.ok)throw new Error('扩展没有构建标识，请加载最新构建。');return response.json();`);
  const runningBuild = await extEval(`const response=await chrome.runtime.sendMessage({type:'VV_GET_BUILD'});if(!response?.ok||!response.result?.build_id)throw new Error('扩展后台没有当前构建标识，请重新加载最新扩展。');return response.result;`);
  if (loadedBuild.build_id !== expectedBuild.build_id || runningBuild.build_id !== expectedBuild.build_id || loadedBuild.strategy !== 'unattended') throw new Error('测试浏览器加载的扩展与当前构建不一致，请重新加载最新扩展。');
  report.extension_build = loadedBuild;
  if (fresh && process.env.VV_EASYCPA_CONFIG_PATH) {
    const accepted = await readEasyCpaAcceptanceConfig(process.env.VV_EASYCPA_CONFIG_PATH, ['gemini-3.8-flash-high', 'gemini-3.7-flash-high', 'gemini-3.1-pro-low']);
    const response = await fetch(`${accepted.profile.base_url}/models`, { headers: { Authorization: `Bearer ${accepted.secret}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`EasyCPA模型目录返回HTTP ${response.status}，停止准备。`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.data)) throw new Error('EasyCPA模型目录格式错误。');
    const live = new Set(catalog.data.map(item => item.id));
    const models = orderedAllowedModels(accepted.profile.model_catalog.models.filter(id => live.has(id)));
    if (!models.length) throw new Error('EasyCPA没有已授权的Gemini模型。');
    const profile = providerProfileSchema.parse({ ...accepted.profile, display_name: 'CPA', model_catalog: { source: 'provider_api', models, refreshed_at: new Date().toISOString() }, capabilities: { ...accepted.profile.capabilities, native_web_search: models.includes('gemini-3.8-flash-high') }, native_web_search_model_ids: models.filter(id => id === 'gemini-3.8-flash-high') });
    await extEval(`await chrome.storage.local.set(${JSON.stringify({ 'provider-profile-index': [profile.provider_profile_id], [`provider-profile:${profile.provider_profile_id}`]: profile, [accepted.secretKey]: accepted.secret, 'vv-popup-preferences': { provider_profile_id: profile.provider_profile_id, model_id: models[0], strategy: 'unattended', observation_input_mode: 'semantic_snapshot' } })});return true;`);
  }
  const config = await extEval(`const keys=await chrome.storage.local.get(["provider-profile-index"]);const ids=keys["provider-profile-index"]||[];const profiles=await chrome.storage.local.get(ids.map(id=>"provider-profile:"+id));return {version:chrome.runtime.getManifest().version,profiles:ids.map(id=>profiles["provider-profile:"+id]).filter(Boolean).map(p=>({id:p.provider_profile_id,name:p.display_name,models:p.model_catalog.models}))};`);
  report.extension_version = config.version;
  const cpa = config.profiles.find((item) => item.name === "CPA");
  report.available_allowed_models = orderedAllowedModels(cpa?.models || []);
  if (cpa && !attachPort && !(fresh && process.env.VV_EASYCPA_CONFIG_PATH)) {
    try {
      const liveModels = await extEval(`
        const stored=await chrome.storage.local.get("provider-profile:${cpa.id}");
        const profile=stored["provider-profile:${cpa.id}"];
        const secrets=await chrome.storage.local.get("provider-secret:"+profile.secret_ref);
        const key=secrets["provider-secret:"+profile.secret_ref];
        const url=profile.base_url.replace(/\\/$/,"")+"/models";
        const response=await fetch(url,{headers:{Authorization:"Bearer "+key}});
        if(!response.ok)throw new Error("模型目录返回 HTTP "+response.status);
        const payload=await response.json();
        return Array.isArray(payload.data)?payload.data.map(item=>item.id).filter(Boolean):[];
      `);
      report.available_allowed_models = orderedAllowedModels(cpa.models.filter((model) => liveModels.includes(model)));
    } catch { throw new Error('无法核对EasyCPA实时模型目录，停止准备；请检查接口权限和配置。'); }
    const preferred = report.available_allowed_models[0];
    if (preferred) await extEval(`const key="vv-popup-preferences";const stored=await chrome.storage.local.get(key);await chrome.storage.local.set({[key]:{...stored[key],provider_profile_id:${JSON.stringify(cpa.id)},model_id:${JSON.stringify(preferred)}}});return true;`);
  } else if (!cpa) report.errors.push("此隔离浏览器配置尚未设置 CPA，请在 VV 扩展设置中配置。");
  await saveReport({ type: "extension_ready", version: config.version, available_allowed_models: report.available_allowed_models });
  controllerTargetId = options.id;
  await poll();
  if (attachPort) await cdpGet(`/json/new?${encodeURIComponent(dashboardUrl)}`, "PUT");
  else await openSite(defaultSite);
  const version = await cdpGet("/json/version");
  const connectionText = JSON.stringify({ profile: profilePath, cdp_port: browserPort, browser_websocket: version.webSocketDebuggerUrl, dashboard_url: dashboardUrl }, null, 2) + "\n";
  await writeFile(connectionPath, connectionText, 'utf8');
  await writeFile(resolve(reportDirectory, 'connection.json'), connectionText, 'utf8');
  timer = setInterval(() => void poll(), 2000);
  console.log(`\nVV 人工验收记录页：${dashboardUrl}`);
  console.log(`监视范围：该测试浏览器所有 HTTP/HTTPS 标签和窗口；调试端口 ${browserPort}`);
  console.log(`记录目录：${reportDirectory}`);
  console.log("可自行打开网站并选择题目。记录页按标签和会话留档；点击停止记录后浏览器仍保持打开。请保留新增的 VV 设置标签。\n");
}

process.on("SIGINT", () => void stopRecorder());
process.on("SIGTERM", () => void stopRecorder());

main().catch(async (error) => {
  console.error("验收程序启动失败：", error);
  if (existsSync(reportDirectory)) {
    report.errors.push(String(error?.message || error));
    await saveReport({ type: "startup_error", message: String(error?.message || error) });
  }
  if (server.listening) server.close();
  if (controller) controller.close();
  process.exitCode = 1;
});
