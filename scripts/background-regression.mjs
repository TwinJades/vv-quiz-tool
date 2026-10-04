// Isolated headless browser only. Never navigates, activates or closes user tabs.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { CdpClient, cdpJson } from "./cdp-client.mjs";
import { createServer } from "node:http";
import { canvasFixtureHtml } from "./canvas-fixture.mjs";
import { installTestNotificationRecorder, readTestNotices } from "./record-test-notifications.mjs";
import { preparePublicCanvas } from "./prepare-public-canvas.mjs";
import { installTestVisualRecorder, readTestVisualReadings } from "./record-test-visual-readings.mjs";
import { authorizedTestModel, assertAcceptanceProvider } from './authorized-test-model.mjs';
import { installTestProviderRecorder } from './record-test-provider-requests.mjs';
import { installTestDomRecorder } from './record-test-dom-transitions.mjs';
import { readEasyCpaAcceptanceConfig } from './read-easycpa-acceptance-config.mjs';

const root = resolve(import.meta.dirname, "..");
const stamp = new Date().toISOString().replaceAll(":", "-");
const runDirectory = resolve(root, ".browser-regression-runtime", `background-${stamp}`);
const extensionDirectory = resolve(runDirectory, "extension");
const browserPath = process.env.VV_TEST_BROWSER || resolve(root, ".browser-regression-runtime/chrome-cft/chrome-win64/chrome.exe");
const sourcePort = Number(process.env.VV_CPA_SOURCE_PORT || 50739);
const localCanvas = process.argv.includes("--canvas-local");
const strategy = process.env.VV_TEST_STRATEGY || "unattended";
if (!["unattended", "supervised"].includes(strategy)) throw new Error("Unknown test strategy");
let localServer;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { started_at: new Date().toISOString(), browser: browserPath, headless: true, parallel: true, selected_model: null, results: [], errors: [] };
report.scope = localCanvas ? "local_canvas_with_real_authorized_model" : "public_websites_with_real_authorized_model";
report.strategy = strategy;
let browser;
let browserControl;
let control;
let port;
let source;
let workerControl;
let saveQueue = Promise.resolve();
let screenshotQueue = Promise.resolve();
let availableSites = [
  { id: "h5p-single", url: "https://h5p.org/h5p/embed/1512", expected_questions: 3 },
  { id: "w3-c", url: "https://www.w3schools.com/quiztest/quiztest.php?qtest=C", expected_questions: 25 },
  { id: "h5p-image-multi", url: "https://h5p.org/h5p/embed/1249570", expected_questions: 1 },
  { id: "h5p-blanks", url: "https://h5p.org/h5p/embed/1039075", expected_questions: 1 },
  { id: "h5p-mixed-text", url: "https://h5pstudio.ecampusontario.ca/content/2360", expected_questions: 8, mixed_text_only: true },
  { id: "h5p-copyright-image-text", url: "https://h5pstudio.ecampusontario.ca/content/60107", expected_questions: 5, mixed_text_image_two_types: true },
  { id: "daily-whole", url: "https://quizofthedayuk.co.uk/", expected_questions: 10, whole_page: true },
  { id: "wordwall-science", url: "https://wordwall.net/resource/114600206/general-science-quiz", expected_questions: 5, public_canvas: true },
];
if (localCanvas) {
  localServer = createServer((request, response) => {
    const kind = request.url?.split("?")[0].split("/").at(-1);
    if (!["single", "multi", "fill"].includes(kind)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(canvasFixtureHtml(kind));
  });
  await new Promise(resolveReady => localServer.listen(0, "127.0.0.1", resolveReady));
  const localPort = localServer.address().port;
  availableSites = ["single", "multi", "fill"].map((kind, index) => ({ id: `canvas-${kind}`, kind,
    url: `http://${index % 2 ? "localhost" : "127.0.0.1"}:${localPort}/canvas/${kind}`, expected_questions: 1 }));
}
const selectedSiteIds = process.env.VV_TEST_SITES?.split(",").map(id => id.trim()).filter(Boolean);
if (selectedSiteIds?.some(id => !availableSites.some(site => site.id === id))) throw new Error("Unknown regression site id");
const sites = selectedSiteIds ? availableSites.filter(site => selectedSiteIds.includes(site.id)) : availableSites.filter(site=>!site.public_canvas);
if (sites.length < 2) throw new Error("Background website regression must run at least two sites in parallel");
const save = () => { const body = JSON.stringify(report, null, 2) + "\n"; saveQueue = saveQueue.then(() => writeFile(resolve(runDirectory, "report.json"), body)); return saveQueue; };
const extEval = body => control.evaluate(`(async()=>{${body}})()`, 45000);

async function runSite(site) {
  let canvasPage;
  const result = { ...site, started_at: new Date().toISOString(), tab_id: null, snapshot: null, website: null, error: null };
  report.results.push(result);
  try {
    const tab = await extEval(`const tab=await chrome.tabs.create({url:${JSON.stringify(site.url)},active:false});return {id:tab.id};`);
    result.tab_id = tab.id;
    const navigationDeadline=Date.now()+45_000;
    let navigationReady=false;
    while(Date.now()<navigationDeadline){
      result.startup_navigation=await extEval(`const tab=await chrome.tabs.get(${tab.id});const frame=await chrome.webNavigation.getFrame({tabId:${tab.id},frameId:0});return {url:frame?.url??tab.url??null,status:tab.status};`);
      const current=result.startup_navigation;
      if(current.url&&/^https?:/.test(current.url)&&current.status==='complete'){
        if(new URL(current.url).origin!==new URL(site.url).origin)throw new Error('Owned test page navigated to a different origin: '+new URL(current.url).origin);
        navigationReady=true;break;
      }
      await pause(250);
    }
    if(!navigationReady)throw new Error('Owned test navigation did not complete before the startup deadline');
    if(site.public_canvas){const prepared=await preparePublicCanvas(site,port,runDirectory);canvasPage=prepared.page;result.bootstrap=prepared.evidence;await save();}
    const request = { type: "VV_START_SESSION", tab_id: tab.id, provider_profile_id: report.provider_id, model_id: report.selected_model, strategy, model_call_limit: 60, observation_input_mode: localCanvas||site.public_canvas ? "visual_snapshot" : "semantic_snapshot" };
    const started = await extEval(`const result=await chrome.runtime.sendMessage(${JSON.stringify(request)});if(!result.ok)throw new Error(result.error);return result.result;`);
    result.snapshot = started;
    const deadline = Date.now() + 12 * 60 * 1000;
    let last = "";
    while (Date.now() < deadline) {
      const snapshot = await extEval(`const result=await chrome.runtime.sendMessage({type:"VV_GET_SESSION",tab_id:${tab.id}});if(!result.ok)throw new Error(result.error);return result.result;`);
      result.snapshot = snapshot;
      const marker = JSON.stringify({ state: snapshot?.state, progress: snapshot?.progress, calls: snapshot?.model_calls, notice: snapshot?.notice });
      if (marker !== last) {
        last = marker;
        console.log(site.id, marker);
        await appendFile(resolve(runDirectory, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), site: site.id, snapshot }) + "\n");
        if (snapshot?.state === "QUEUED") report.queue_evidence = await extEval('const r=await chrome.runtime.sendMessage({type:"VV_GET_TASKS"});return r.result?{concurrency:r.result.concurrency,running:r.result.running,queued:r.result.queued}:null;');
        await save();
      }
      if (["COMPLETE", "PAUSED", "FAILED", "CANCELLED"].includes(snapshot?.state)) break;
      await pause(800);
    }
    if (!["COMPLETE", "PAUSED", "FAILED", "CANCELLED"].includes(result.snapshot?.state)) {
      await extEval(`return chrome.runtime.sendMessage({type:"VV_STOP_SESSION",tab_id:${tab.id}});`);
      result.error = "Test deadline exceeded; stopped own test session";
    }
    result.website = await extEval(`const [result]=await chrome.scripting.executeScript({target:{tabId:${tab.id}},world:"MAIN",func:()=>({url:location.href,title:document.title,text:document.body?.innerText.slice(-6000),canvas:window.canvasState??null,visibility:document.visibilityState})});return result?.result;`);
    if(sites.some(site=>site.mixed_text_only)){
      result.dom_transitions=await extEval(`return chrome.scripting.executeScript({target:{tabId:${tab.id},allFrames:true},func:()=>globalThis.__vvTestDomTransitions??[]}).then(rows=>rows.map(row=>({frame_id:row.frameId,transitions:row.result})));`);
    }
    const target = (await cdpJson(port, "/json/list")).find(target => target.url === result.website?.url && target.type === "page");
    if (target) {
      const page = new CdpClient(target.webSocketDebuggerUrl);
      try {
        if (localCanvas||site.public_canvas) {
          let frames=0;
          const acknowledge=event=>{const message=JSON.parse(event.data);if(message.method==='Page.screencastFrame'){
            frames++;void page.send('Page.screencastFrameAck',{sessionId:message.params.sessionId}).catch(()=>{});
          }};
          page.socket.addEventListener('message',acknowledge);
          await page.send("Page.startScreencast", {format:"png",maxFramesInFlight:1});
          try {
            const image=await page.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
            await writeFile(resolve(runDirectory,`${site.id}.png`),Buffer.from(image.data,"base64"));
            if((localCanvas || site.public_canvas) && result.snapshot?.state==='COMPLETE') {
              // Preserve the immediate product result, then wait only for the
              // owned site's final animation so a human can inspect its score.
              // No input, model request, tab activation or desktop focus occurs.
              await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
              try {
                await pause(5000);
                const settled=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
                const path=resolve(runDirectory,`${site.id}-settled.png`);
                await writeFile(path,Buffer.from(settled.data,'base64'));
                result.post_completion_visual_settle={milliseconds:5000,screenshot:path,input_sent:false,model_calls:0,tab_activated:false,screencast_frames_acknowledged:frames};
                if(localCanvas){
                  // Preserve both original captures. Repaint only this owned
                  // fixed-size fixture viewport after COMPLETE; never redraw
                  // canvas pixels or alter answers, and restore its dimensions.
                  const viewport=await page.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
                  if(viewport.width<1||viewport.height<1||viewport.width>16000||viewport.height>16000)throw new Error('Owned viewport dimensions invalid');
                  try{await page.send('Emulation.setDeviceMetricsOverride',{width:viewport.width+1,height:viewport.height,deviceScaleFactor:viewport.dpr,mobile:false});}
                  finally{await page.send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:viewport.dpr,mobile:false});}
                  await pause(250);
                  const repainted=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true});
                  const repaintPath=resolve(runDirectory,`${site.id}-repainted.png`);
                  await writeFile(repaintPath,Buffer.from(repainted.data,'base64'));
                  result.post_completion_viewport_repaint={screenshot:repaintPath,viewport,restored:true,input_sent:false,model_calls:0,canvas_pixels_modified:false};
                }
              }finally{await page.send('Emulation.setFocusEmulationEnabled',{enabled:false});}
            }
          } finally { await page.send("Page.stopScreencast").catch(()=>{}); page.socket.removeEventListener('message',acknowledge); }
        } else {
        // Activate and serialize only pages owned by this headless run.
        const capture = screenshotQueue.then(async () => {
          await page.send("Page.bringToFront");
          const image = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          await writeFile(resolve(runDirectory, `${site.id}.png`), Buffer.from(image.data, "base64"));
        });
        screenshotQueue = capture.catch(() => {});
        await capture;
        }
      } finally { page.close(); }
    }
  } catch (error) { result.error = String(error.message || error); }
  finally {canvasPage?.close();}
  result.finished_at = new Date().toISOString();
  result.passed = result.snapshot?.state === "COMPLETE" && result.snapshot.progress.answered === site.expected_questions && Boolean(result.website) && !result.error;
  if(site.whole_page) result.passed &&= Boolean(result.snapshot.summary?.visible_score) &&
    (result.snapshot.steps?.find(step=>step.step==='solve_batch')?.calls??0)>=2 &&
    result.snapshot.steps?.find(step=>step.step==='execute_session_submit')?.calls===1;
  if(localCanvas) result.passed &&= Boolean(result.website?.canvas?.completed) &&
    result.snapshot.progress.total === site.expected_questions &&
    result.snapshot.summary?.visible_score === (site.kind === "multi" ? "2/2" : "1/1") &&
    result.website.canvas.events.every(event=>event.trusted) && result.website.visibility === "hidden";
  if(site.public_canvas) result.passed &&= Boolean(result.snapshot?.summary?.visible_score) &&
    (result.snapshot?.summary?.visual_metrics?.coordinate_clicks??0)>0 && result.website?.visibility==='hidden';
}

try {
  await mkdir(runDirectory, { recursive: true });
  console.log("REPORT_DIRECTORY", runDirectory);
  let configuration;
  if (process.env.VV_EASYCPA_CONFIG_PATH) {
    configuration = await readEasyCpaAcceptanceConfig(process.env.VV_EASYCPA_CONFIG_PATH,
      process.env.VV_EASYCPA_MODELS?.split(',').map(id => id.trim()).filter(Boolean));
    report.configuration_source = 'existing_easycpa_client_access_config';
    report.configured_models = configuration.profile.model_catalog.models;
  } else {
  // Read only the selected existing local CPA profile; never print its secret.
  const sourceTarget = (await cdpJson(sourcePort, "/json/list")).find(target => /^chrome-extension:\/\//.test(target.url) && /\/(?:options\.html|background\.js)$/.test(target.url));
  if (!sourceTarget) throw new Error("Existing configured VV extension context not found");
  source = new CdpClient(sourceTarget.webSocketDebuggerUrl);
  configuration = await source.evaluate(`(async()=>{const data=await chrome.storage.local.get(null);const id=data["provider-profile-index"]?.find(id=>data["provider-profile:"+id]?.display_name==="CPA");if(!id)throw new Error("CPA profile missing");const profile=data["provider-profile:"+id];const secretKey="provider-secret:"+profile.secret_ref;return {profile,secretKey,secret:data[secretKey]};})()`);
  source.close(); source = null;
  report.configuration_source = 'existing_vv_browser_profile';
  }
  assertAcceptanceProvider(configuration.profile);
  report.provider_base_url = configuration.profile.base_url;
  if ((localCanvas||sites.some(site=>site.public_canvas)) && (!configuration.profile.image_upload_authorized || !configuration.profile.capabilities.image_input)) throw new Error("Configured CPA has no existing image authorization/capability");
  const build = spawnSync(process.execPath, [resolve(root, "scripts/build.mjs")], { cwd: root, env: { ...process.env, VV_BUILD_DIR: extensionDirectory }, stdio: "inherit" });
  if (build.status !== 0) throw new Error("Isolated extension build failed");
  const manifest = JSON.parse(await readFile(resolve(extensionDirectory, "manifest.json"), "utf8"));
  manifest.host_permissions = [...new Set([...sites.map(site => `${new URL(site.url).origin}/*`), `${new URL(configuration.profile.base_url).origin}/*`])];
  if (localCanvas) manifest.host_permissions.push("http://127.0.0.1/*", "http://localhost/*");
  await writeFile(resolve(extensionDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
  await installTestNotificationRecorder(extensionDirectory);
  if(sites.some(site=>site.mixed_text_only))await installTestDomRecorder(extensionDirectory);
  if(localCanvas||sites.some(site=>site.public_canvas)) await installTestVisualRecorder(extensionDirectory);
  await installTestProviderRecorder(extensionDirectory);
  report.notification_delivery = 'private_build_recording_only_no_os_notifications';
  browser = spawn(browserPath, ["--headless=new", "--remote-debugging-port=0", "--enable-unsafe-extension-debugging", `--user-data-dir=${resolve(runDirectory, "profile")}`, `--load-extension=${extensionDirectory}`, `--disable-extensions-except=${extensionDirectory}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "about:blank"], { cwd: root, stdio: "ignore", windowsHide: true });
  browser.on("error", error => { report.errors.push(error.message); });
  for (let attempt = 0; attempt < 150; attempt++) {
    try { port = Number((await readFile(resolve(runDirectory, "profile/DevToolsActivePort"), "utf8")).split("\n")[0]); await cdpJson(port, "/json/version"); break; } catch { await pause(200); }
  }
  if (!port) throw new Error("Headless Chrome CDP startup failed");
  report.cdp_port = port;
  const version = await cdpJson(port, "/json/version");
  report.browser_version = version.Browser;
  browserControl = new CdpClient(version.webSocketDebuggerUrl);
  try { await browserControl.send("Extensions.loadUnpacked", { path: extensionDirectory }); }
  catch (error) { report.extension_load_method_error = error.message; }
  let id;
  for (let attempt = 0; attempt < 80; attempt++) {
    const workers = (await cdpJson(port, "/json/list")).filter(target => target.type === "service_worker" && target.url.endsWith("/background.js"));
    for (const worker of workers) {
      const probe = new CdpClient(worker.webSocketDebuggerUrl);
      try {
        if (await probe.evaluate('globalThis.chrome?.runtime?.getManifest()?.name === "VV 自动答题工具"')) id = new URL(worker.url).host;
      } catch {} finally { probe.close(); }
      if (id) break;
    }
    if (id) break;
    await pause(200);
  }
  if (!id) throw new Error("VV did not load in isolated headless browser");
  report.extension_id = id;
  const worker = (await cdpJson(port, "/json/list")).find(target => target.type === "service_worker" && target.url.startsWith(`chrome-extension://${id}/`));
  if (!worker) throw new Error("Verified VV worker is unavailable");
  workerControl = new CdpClient(worker.webSocketDebuggerUrl);
  if(!await workerControl.evaluate('typeof globalThis.__vvTestNotify==="function"')) throw new Error('Private notification recording transport was not installed');
  report.notifications_stubbed_to_avoid_os_toasts = true;
  const target = await cdpJson(port, `/json/new?${encodeURIComponent(`chrome-extension://${id}/options.html`)}`, "PUT");
  control = new CdpClient(target.webSocketDebuggerUrl);
  let optionsReady = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await control.evaluate(`Boolean(globalThis.chrome?.storage?.local && globalThis.chrome?.runtime?.id === ${JSON.stringify(id)})`)) { optionsReady = true; break; }
    await pause(100);
  }
  if (!optionsReady) throw new Error("Isolated VV options context did not become ready");
  const stored = { "provider-profile-index": [configuration.profile.provider_profile_id], [`provider-profile:${configuration.profile.provider_profile_id}`]: configuration.profile, [configuration.secretKey]: configuration.secret };
  await extEval(`await chrome.storage.local.set(${JSON.stringify(stored)});return true;`);
  const catalog=await extEval(`const data=await chrome.storage.local.get(null);const p=data[${JSON.stringify("provider-profile:" + configuration.profile.provider_profile_id)}];const base=p.base_url.endsWith("/")?p.base_url.slice(0,-1):p.base_url;const attempts=[];for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(base+"/models",{signal:AbortSignal.timeout(8000),headers:{Authorization:"Bearer "+data["provider-secret:"+p.secret_ref]}});attempts.push({status:r.status});if(r.ok){const body=await r.json();if(!Array.isArray(body.data))return {models:null,attempts,error:"Invalid CPA model catalog"};return {models:body.data.map(item=>item.id),attempts,error:null};}if(r.status!==429&&r.status<500)return {models:null,attempts,error:"CPA model catalog HTTP "+r.status};}catch(error){attempts.push({status:null,error:"catalog_network_or_timeout"});}if(attempt<2)await new Promise(resolve=>setTimeout(resolve,(attempt+1)*1000));}return {models:null,attempts,error:"CPA model catalog unavailable after three bounded requests"};`);
  report.catalog_requests=catalog.attempts;await save();
  if(catalog.error)throw new Error(catalog.error);
  const available=catalog.models;
  let fallbackEvidence;
  if(process.env.VV_TEST_FALLBACK_REPORT){
    const path=resolve(process.env.VV_TEST_FALLBACK_REPORT),local=relative(resolve(root,'.browser-regression-runtime'),path);
    if(isAbsolute(local)||local.startsWith('..')||!/^background-[^\\/]+[\\/]report\.json$/.test(local))throw new Error('Fallback evidence must be an owned retained background report');
    fallbackEvidence=JSON.parse(await readFile(path,'utf8'));report.fallback_evidence=path;
  }
  const selection=authorizedTestModel({configured:configuration.profile.model_catalog.models,available,
    requested:process.env.VV_TEST_MODEL,fallbackEvidence});
  report.selected_model=selection.id;report.authorized_models=selection.allowed;report.preferred_model_service_fallback=selection.fallback;
  report.provider_id = configuration.profile.provider_profile_id;
  await save();
  await Promise.all(sites.map(runSite));
  report.provider_requests = await workerControl.evaluate('globalThis.__vvTestProviderRequests??[]');
  report.notification_requests = await control.evaluate(readTestNotices);
  report.visual_readings = await control.evaluate(readTestVisualReadings);
  if(localCanvas||sites.some(site=>site.public_canvas)) {
    const pixels=await workerControl.evaluate('globalThis.__vvTestPixels??[]');
    report.visual_captures=[];
    for(const [index,item] of pixels.entries()) {
      const {png,...metadata}=item;
      const path=resolve(runDirectory,`visual-capture-${index}.png`);
      await writeFile(path,Buffer.from(png,'base64'));
      report.visual_captures.push({...metadata,path});
    }
  }
  const panelTarget = await cdpJson(port, `/json/new?${encodeURIComponent(`chrome-extension://${id}/tasks.html`)}`, "PUT");
  const panel = new CdpClient(panelTarget.webSocketDebuggerUrl);
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      report.task_panel = await panel.evaluate('({cards:document.querySelectorAll(".task").length,queue:document.querySelector("#queue")?.textContent,error:document.querySelector("#error")?.textContent})');
      if (report.task_panel.cards >= sites.length) break;
      await pause(200);
    }
    const image = await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(resolve(runDirectory, "task-panel.png"), Buffer.from(image.data, "base64"));
    if (report.task_panel.cards !== sites.length || report.task_panel.error) report.errors.push("Unified task panel did not render every site correctly");
  } finally { panel.close(); }
  if (report.results.some(result => !result.passed)) process.exitCode = 1;
} catch (error) { report.errors.push(String(error.message || error)); process.exitCode = 1; }
finally {
  localServer?.close();
  report.finished_at = new Date().toISOString();
  await save();
  source?.close(); control?.close(); workerControl?.close();
  if (browserControl) { try { await browserControl.send("Browser.close"); } catch {} browserControl.close(); }
  // A failed bootstrap has no browser endpoint; this handle belongs only to this run.
  else browser?.kill();
  console.log("FINAL", JSON.stringify({ directory: runDirectory, errors: report.errors, results: report.results.map(result => ({ site: result.id, state: result.snapshot?.state, progress: result.snapshot?.progress, error: result.error })) }));
}
