// Real MV3 browsers, local HTTP protocol fixtures only. No external model calls.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CdpClient, cdpJson } from "./cdp-client.mjs";
import { canvasFixtureHtml, readingFromScreenshot } from "./canvas-fixture.mjs";
import { installTestNotificationRecorder, readTestNotices } from "./record-test-notifications.mjs";
import { budgetFixtureHtml, runBudgetCases } from "./budget-fixture.mjs";
import { runPanelCases } from "./panel-acceptance.mjs";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, ".browser-regression-runtime", `provider-mv3-${new Date().toISOString().replaceAll(":", "-")}`);
const extension = resolve(directory, "extension");
const interactionTests = process.argv.includes("--interaction");
const visualTests = process.argv.includes("--visual");
const visualActiveTests = process.argv.includes("--visual-active");
const unthrottledTests = process.argv.includes("--unthrottled");
const settingsTests = process.argv.includes("--settings");
const timerTests = process.argv.includes("--timer");
const lifecycleTests = process.argv.includes("--lifecycle");
const budgetTests = process.argv.includes("--budget");
const panelTests = process.argv.includes("--panel");
const heldTimers = new Map();
const heldMedia = new Map();
const mediaRequests = new Map();
const heldLife = new Map();
const lifeCounts = new Map();
const report = { started_at: new Date().toISOString(), mode: "local_protocol_fixtures", headless: true, parallel: true, external_model_calls: 0, browsers: [], requests: [], errors: [] };
report.visual_tab_scope = visualActiveTests ? "rotating_active_tabs_in_owned_headless_browser" : "inactive_tabs";
const backgroundFlags = unthrottledTests ? ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"] : [];
report.headless_background_flags = backgroundFlags;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const manualRequests = new Map();
const heldAnswers = new Map();
const releasedAnswers = new Set();
function releaseManual(name, id) {
  const key = `${name}:${id}`;
  releasedAnswers.add(key);
  heldAnswers.get(key)?.();
  heldAnswers.delete(key);
}

class PipeCdp {
  constructor(child) {
    this.input = child.stdio[3];
    this.pending = new Map();
    this.buffer = "";
    this.next = 0;
    child.stdio[4].on("data", chunk => {
      this.buffer += chunk.toString();
      let delimiter;
      while ((delimiter = this.buffer.indexOf("\0")) >= 0) {
        const value = this.buffer.slice(0, delimiter);
        this.buffer = this.buffer.slice(delimiter + 1);
        if (!value) continue;
        const message = JSON.parse(value);
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      }
    });
    child.stdio[4].on("close", () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error("Owned browser exited")); }
      this.pending.clear();
    });
    this.input.on("error", () => {});
  }
  send(method, params = {}, sessionId) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
      this.pending.set(id, { resolve, reject, timeout });
      this.input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
  async attach(targetId) {
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    return {
      send: (method, params) => this.send(method, params, sessionId),
      evaluate: async expression => {
        const value = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
        return value.result.value;
      },
    };
  }
}

function answerFor(batch) {
  return { schema_version: "1.0", session_id: batch.session_id, batch_id: batch.batch_id, errors: [],
    answers: batch.questions.map(q => ({ schema_version: "1.0", session_id: q.session_id,
      question_id: q.question_id, observation_id: q.observation_id, answer_type: q.type,
      status: "answered", selected_option_ids: q.type === "fill_blank" ? [] : q.type === "multiple_choice" ? q.options.map(option => option.id) : [q.options[0].id],
      blank_answers: q.type === "fill_blank" ? q.blanks.map(blank => ({ blank_id: blank.id, value: "Alpha" })) : [], confidence: 1, warnings: [] })) };
}
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET") {
      if(request.url.startsWith('/slow-media/')) {
        const count=(mediaRequests.get(request.url)??0)+1;mediaRequests.set(request.url,count);
        if(count>1)await new Promise(resolve=>heldMedia.set(request.url,resolve));
        response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});
        response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));return;
      }
      if (request.url.endsWith("/v1/models")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ models: [{ name: "models/gemini-3.8-flash", inputTokenLimit: 8192, supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.1-pro", inputTokenLimit: 16384, supportedGenerationMethods: ["generateContent"] }] }));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (request.url.startsWith('/budget/')) {
        response.end(budgetFixtureHtml(Number(request.url.split('/')[2]))); return;
      }
      if (request.url.startsWith("/timer/")) {
        const seconds=request.url.includes('/stalled')?6:120;
        const image=request.url.includes('media-shortened')?`<img width="16" height="16" src="/slow-media/${request.url.split('/').slice(2).join('/')}.png">`:'';
        response.end(`<!doctype html><title>VV timer close-out fixture</title><span role="timer" data-remaining-seconds="${seconds}">${seconds}</span><main>${Array.from({length:2},(_,i)=>`<fieldset><legend>Question ${i+1}: Choose Alpha</legend>${i===0?image:''}<label><input type="radio" name="q${i}" value="a">Alpha</label><label><input type="radio" name="q${i}" value="b">Beta</label></fieldset>`).join("")}<button id="submit">Submit quiz</button></main><script>document.querySelector('#submit').onclick=()=>{window.submissions=(window.submissions||0)+1;const score=document.querySelectorAll('input[value=a]:checked').length;document.body.innerHTML='<main>You got '+score+' out of 2 points</main>'};</script>`);
        return;
      }
      if (request.url.startsWith("/whole/")) {
        response.end(`<!doctype html><title>VV six-question page batch fixture</title><main>${Array.from({length:6},(_,i)=>`<fieldset data-vv-question><legend>Question ${i+1}: Choose Alpha</legend><label><input type="radio" name="q${i}" value="a">Alpha</label><label><input type="radio" name="q${i}" value="b">Beta</label></fieldset>`).join("")}<button id="submit">Submit quiz</button></main><script>document.querySelector('#submit').onclick=()=>{window.submissions=(window.submissions||0)+1;const score=document.querySelectorAll('input[value=a]:checked').length;document.body.innerHTML='<main>You got '+score+' out of 6 points</main>'};</script>`);
        return;
      }
      if (request.url.startsWith("/canvas/")) {
        response.end(canvasFixtureHtml(request.url.split("?")[0].split("/").at(-1)));
        return;
      }
      if (request.url.startsWith("/manual/closed")) { response.end(canvasFixtureHtml("single", true)); return; }
      if (request.url.startsWith("/manual/iframe")) {
        const port = server.address().port;
        response.end(`<!doctype html><title>VV cross origin iframe interaction</title><nav><button id="menu">Menu</button></nav><iframe width="600" height="300" src="http://localhost:${port}/manual/inner"></iframe>`);
        return;
      }
      if (request.url.startsWith("/manual/fill")) {
        response.end(`<!doctype html><title>VV keyboard interaction</title><nav><button id="menu">Menu</button></nav>
          <fieldset><legend>Type Alpha</legend><label>Answer <input type="text"></label></fieldset><button id="check">Check</button>
          <script>document.querySelector('#check').onclick=()=>{if(document.querySelector('input').value==='Alpha')document.body.innerHTML='<main>You got 1 out of 1 points</main>'};</script>`);
        return;
      }
      response.end(`<!doctype html><html><head><title>VV local MV3 compatibility</title></head><body><nav><button id="menu">Menu</button></nav>
        <fieldset data-vv-question><legend>Choose Alpha</legend><label><input type="radio" name="q" value="a">Alpha</label><label><input type="radio" name="q" value="b">Beta</label></fieldset>
        <button id="check">Check</button><script>document.querySelector('#check').onclick=()=>{if(document.querySelector('input[value=a]').checked)document.body.innerHTML='<main>You got 1 out of 1 points</main>'};</script></body></html>`);
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const type = request.url.includes("/google/") ? "google" : request.url.includes("/anthropic/") ? "anthropic" : "openai_compatible";
    const user = type === "google" ? null : body.messages.find(message => message.role === "user").content;
    const text = type === "google" ? body.contents[0].parts.find(part => part.text).text
      : typeof user === "string" ? user : user.find(part => part.type === "text").text;
    const visual = text.startsWith('{"visual_frame_id"');
    const batch = visual ? null : JSON.parse(text.slice(text.indexOf("{\"batch\""))).batch;
    if (visual) {
      const metadata = JSON.parse(text);
      const imageUrl = user.find(part => part.type === "image_url").image_url.url;
      await writeFile(resolve(directory, `visual-${metadata.visual_frame_id}.png`), Buffer.from(imageUrl.split(",")[1], "base64"));
    }
    const recognized = visual ? readingFromScreenshot(body, JSON.parse(text)) : null;
    if (recognized) report.requests.push({ protocol: "visual_pixels", ...recognized.evidence });
    const answer = recognized ? recognized.result : answerFor(batch);
    const lifeCase=request.url.match(/\/life-([^/]+)\//)?.[1];
    if(lifeCase) {
      const key=`${request.url.split('/')[1]}:${lifeCase}`;
      const count=(lifeCounts.get(key)||0)+1;lifeCounts.set(key,count);
      if(count===1)await new Promise(resolve=>heldLife.set(key,resolve));
    }
    const timerCase=request.url.match(/\/timer-([^/]+)\//)?.[1];
    if(timerCase)await new Promise(resolve=>heldTimers.set(`${request.url.split('/')[1]}:${timerCase}`,resolve));
    const manualCase = request.url.match(/\/manual-([^/]+)\//)?.[1];
    if (manualCase) {
      const key = request.url;
      const count = (manualRequests.get(key) ?? 0) + 1;
      manualRequests.set(key, count);
      const holdKey = `${request.url.split("/")[1]}:${manualCase}`;
      if (count === 1 && !releasedAnswers.has(holdKey)) {
        await new Promise(resolve => heldAnswers.set(holdKey, resolve));
      }
    }
    const search = type === "anthropic" && body.tools?.some(tool => tool.type === "web_search_20250305");
    report.requests.push({ url: request.url, protocol: type, searched: search,
      max_uses: body.tools?.find(tool => tool.type === "web_search_20250305")?.max_uses ?? null,
      question_count: batch?.questions.length ?? 0 });
    if (/\/budget-retry-/.test(request.url)) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Deliberate local retry fixture failure' } })); return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    if (type === "google") response.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } }));
    else if (type === "anthropic") response.end(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: body.model,
      content: [...(search ? [{ type: "server_tool_use", id: "search_1", name: "web_search", input: { query: "local fixture" } },
        { type: "web_search_tool_result", tool_use_id: "search_1", content: [] }] : []), { type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    else response.end(JSON.stringify({ id: "chat_fixture", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  } catch (error) {
    report.fixture_errors ??= [];
    report.fixture_errors.push({ url: request.url, message: String(error.message || error) });
    response.writeHead(500); response.end(JSON.stringify({ error: String(error.message || error) }));
  }
});

async function runBrowser(name, path, port) {
  const result = { name, browser: path, version: null, extension_loaded: false, results: [], errors: [] };
  report.browsers.push(result);
  const stderr = [];
  const profile = resolve(directory, name);
  const useTcp = name === "edge";
  const child = spawn(path, ["--headless=new", useTcp ? "--remote-debugging-port=0" : "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
    ...backgroundFlags,
    `--user-data-dir=${resolve(directory, name)}`, `--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "about:blank"],
    { windowsHide: true, stdio: useTcp ? ["ignore", "ignore", "pipe"] : ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  child.on("error", error => result.errors.push(error.message));
  child.on("exit", (code, signal) => { result.launcher_exit = { code, signal }; });
  child.stderr.on("data", chunk => stderr.push(chunk.toString()));
  let cdp;
  let notificationWorker;
  try {
    if (useTcp) {
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          const browserPort = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
          const version = await cdpJson(browserPort, "/json/version");
          cdp = new CdpClient(version.webSocketDebuggerUrl);
          break;
        } catch { await pause(200); }
      }
      if (!cdp) throw new Error("No Edge CDP endpoint appeared in the owned profile");
    } else cdp = new PipeCdp(child);
    result.version = (await cdp.send("Browser.getVersion")).product;
    console.log(name, "browser ready", result.version);
    let extensionId;
    try { extensionId = (await cdp.send("Extensions.loadUnpacked", { path: extension })).id; }
    catch (error) { result.extension_load_method_error = error.message; }
    for (let attempt = 0; attempt < 60; attempt++) {
      const { targetInfos } = await cdp.send("Target.getTargets");
      for (const target of targetInfos.filter(target => target.type === "service_worker" && target.url.endsWith("/background.js"))) {
        const worker = await cdp.attach(target.targetId);
        if (await worker.evaluate('globalThis.chrome?.runtime?.getManifest()?.name === "VV 自动答题工具"')) {
          extensionId = new URL(target.url).host;
          notificationWorker = worker;
          break;
        }
      }
      if (extensionId && notificationWorker) break;
      await pause(100);
    }
    if (!extensionId || !notificationWorker) throw new Error("VV extension and notification suppression did not register in this owned headless browser");
    result.extension_loaded = true;
    result.notification_probe = await notificationWorker.evaluate('({url:location.href,recorder:typeof globalThis.__vvTestNotify==="function"})');
    if(!result.notification_probe.recorder)throw new Error('Private notification recording transport was not installed');
    console.log(name, "VV registered", extensionId);
    const { targetId } = await cdp.send("Target.createTarget", { url: `chrome-extension://${extensionId}/options.html` });
    const control = await cdp.attach(targetId);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await control.evaluate('Boolean(globalThis.chrome?.storage?.local)')) break;
      await pause(100);
    }
    const profiles = ["google", "anthropic", "openai_compatible"].map(type => ({
      schema_version: "1.0", provider_profile_id: type, display_name: `Local ${type}`, provider_type: type,
      base_url: `http://127.0.0.1:${port}/${name}/${type}/v1`, secret_ref: type,
      model_catalog: { source: "manual", models: [type === "anthropic" ? "claude-sonnet-4-5" : "gemini-3.8-flash"], refreshed_at: null },
      capabilities: { image_input: false, structured_output: true, native_web_search: type === "anthropic" },
      native_web_search_model_ids: type === "anthropic" ? ["claude-sonnet-4-5"] : [], image_upload_authorized: false,
    }));
    const data = { "provider-profile-index": profiles.map(profile => profile.provider_profile_id) };
    for (const profile of profiles) { data[`provider-profile:${profile.provider_profile_id}`] = profile; data[`provider-secret:${profile.secret_ref}`] = "local-fixture-only"; }
    await control.evaluate(`chrome.storage.local.set(${JSON.stringify(data)})`);
    if(panelTests) await runPanelCases({name,port,profiles,control,cdp,extensionId,result,directory,writeFile,resolve,heldLife,lifeCounts});
    if(lifecycleTests) {
      const item=result.lifecycle={passed:false,error:null,checks:[]};
      const send=async request=>{const response=await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(request)})`);if(!response.ok)throw new Error(response.error);return response.result;};
      const state=tabId=>send({type:'VV_GET_SESSION',tab_id:tabId});
      const waitFor=async(check,label)=>{for(let i=0;i<200;i++){if(await check())return;await pause(50);}throw new Error(`Lifecycle observation deadline: ${label}`);};
      const release=id=>{const key=`${name}:${id}`;heldLife.get(key)?.();heldLife.delete(key);};
      const start=async(id,strategy='unattended')=>{
        const p={...profiles.find(p=>p.provider_type==='openai_compatible'),provider_profile_id:`life-${id}`,secret_ref:`life-${id}`,base_url:`http://127.0.0.1:${port}/${name}/openai_compatible/life-${id}/v1`};
        await control.evaluate(`chrome.storage.local.set(${JSON.stringify({[`provider-profile:${p.provider_profile_id}`]:p,[`provider-secret:${p.secret_ref}`]:'local-fixture-only'})})`);
        const url=`http://${id==='b'||id==='ctl2'?'127.0.0.1':'localhost'}:${port}/life/${name}/${id}`;
        const tab=await control.evaluate(`chrome.tabs.create({url:${JSON.stringify(url)},active:false})`);await pause(200);
        const request={type:'VV_START_SESSION',tab_id:tab.id,provider_profile_id:p.provider_profile_id,model_id:p.model_catalog.models[0],strategy,model_call_limit:5,observation_input_mode:'structured'};
        await send(request);return {tab,id,request,url};
      };
      const finish=async job=>{release(job.id);await waitFor(async()=> (await state(job.tab.id))?.state==='COMPLETE',`${job.id} complete`);};
      try {
        await send({type:'VV_SET_CONCURRENCY',limit:3});
        const a=await start('a'),b=await start('b'),c=await start('c'),d=await start('d');
        await waitFor(async()=>{const panel=await send({type:'VV_GET_TASKS'});item.initial_queue=panel;return panel.running.length===3&&panel.queued.length===1&&['a','b','c'].every(id=>heldLife.has(`${name}:${id}`));},'default three plus one queued');
        await send({type:'VV_PAUSE_SESSION',tab_id:d.tab.id});
        if((await state(d.tab.id)).state!=='PAUSED'||lifeCounts.has(`${name}:d`))throw new Error('Queued pause sent a model request');
        await send({type:'VV_RESUME_SESSION',tab_id:d.tab.id});
        const duplicate=await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(d.request)})`);
        const remove=await control.evaluate(`chrome.runtime.sendMessage({type:'VV_DELETE_PROVIDER',provider_profile_id:'life-b'})`);
        if(duplicate.ok||remove.ok)throw new Error('Duplicate start or active provider deletion was accepted');
        item.checks.push('default3/queued_pause_resume/duplicate_start/active_provider_guard');
        await send({type:'VV_SET_CONCURRENCY',limit:2});await finish(a);
        await waitFor(async()=>{const panel=await send({type:'VV_GET_TASKS'});return panel.running.length===2&&panel.queued.includes(d.tab.id);},'reduced limit retains running tasks');
        await send({type:'VV_SET_CONCURRENCY',limit:3});await waitFor(async()=>heldLife.has(`${name}:d`),'increased limit starts queued task');await finish(d);
        item.checks.push('limit_decrease_nonpreemptive/limit_increase');
        await send({type:'VV_PAUSE_SESSION',tab_id:b.tab.id});await waitFor(async()=> !(await send({type:'VV_GET_TASKS'})).running.includes(b.tab.id),'paused runner settles');release('b');await pause(100);
        const [beforeResume]=await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${b.tab.id}},func:()=>document.querySelector('input[value=a]').checked})`);
        if(beforeResume.result!==false)throw new Error('Late response applied after pause');
        await send({type:'VV_RESUME_SESSION',tab_id:b.tab.id});await waitFor(async()=> (await state(b.tab.id)).state==='COMPLETE','resumed held task');
        await send({type:'VV_STOP_SESSION',tab_id:c.tab.id});await send({type:'VV_CLEAR_SESSION',tab_id:c.tab.id});release('c');await pause(100);
        if(await state(c.tab.id))throw new Error('Cleared cancelled task reappeared');
        const stored=await control.evaluate(`chrome.storage.session.get('vv-session-snapshot:${c.tab.id}')`);
        if(Object.keys(stored).length)throw new Error('Cancelled task snapshot remained after clear');
        await send({type:'VV_CLEAR_SESSION',tab_id:a.tab.id});
        if(await state(a.tab.id))throw new Error('Completed task clear retained a summary');
        item.checks.push('pause_late_response/resume/stop_clear/session_storage_clear');
        // Actual extension panels and actual port disconnection, only owned tabs.
        const panels=await Promise.all([1,2].map(async()=> (await cdp.send('Target.createTarget',{url:`chrome-extension://${extensionId}/tasks.html`})).targetId));
        await pause(300);
        const ctl1=await start('ctl1','supervised'),ctl2=await start('ctl2','supervised'),ctlU=await start('ctlu');
        await waitFor(async()=>['ctl1','ctl2','ctlu'].every(id=>heldLife.has(`${name}:${id}`)),'controller tasks held');
        await cdp.send('Target.closeTarget',{targetId:panels[0]});await pause(150);
        if((await state(ctl1.tab.id)).state!=='SOLVE')throw new Error('One of two controllers closing paused supervision');
        await cdp.send('Target.closeTarget',{targetId:panels[1]});
        await waitFor(async()=> (await state(ctl1.tab.id)).state==='PAUSED'&&(await state(ctl2.tab.id)).state==='PAUSED','last supervised controller closes');
        if((await state(ctlU.tab.id)).state!=='SOLVE')throw new Error('Unattended task paused with controller close');
        release('ctl1');release('ctl2');await finish(ctlU);
        const panel=(await cdp.send('Target.createTarget',{url:`chrome-extension://${extensionId}/tasks.html`})).targetId;await pause(200);
        await send({type:'VV_RESUME_SESSION',tab_id:ctl1.tab.id});await send({type:'VV_RESUME_SESSION',tab_id:ctl2.tab.id});
        await waitFor(async()=> (await state(ctl1.tab.id)).state==='COMPLETE'&&(await state(ctl2.tab.id)).state==='COMPLETE','supervised resumes after fresh panel');
        for(const job of [ctl1,ctl2,ctlU])await send({type:'VV_CLEAR_SESSION',tab_id:job.tab.id});
        await cdp.send('Target.closeTarget',{targetId:panel});
        item.checks.push('multiple_controllers/last_controller_supervised_pause/unattended_continues');
        const closed=await start('closed');await waitFor(async()=>heldLife.has(`${name}:closed`),'closed task model held');
        await control.evaluate(`chrome.tabs.remove(${closed.tab.id})`);release('closed');
        await waitFor(async()=>!(await send({type:'VV_GET_TASKS'})).tasks.some(task=>task.tab_id===closed.tab.id),'closed tab removed from panel');
        if(await state(closed.tab.id))throw new Error('Closed tab session retained');
        item.checks.push('target_tab_close');
        const nav=await start('nav');await waitFor(async()=>heldLife.has(`${name}:nav`),'navigation task model held');
        const deniedUrl=`http://127.0.0.2:${port}/life/${name}/nav`;
        await control.evaluate(`chrome.tabs.update(${nav.tab.id},{url:${JSON.stringify(deniedUrl)}})`);
        await waitFor(async()=>{const snapshot=await state(nav.tab.id);item.navigation={snapshot,tab:await control.evaluate(`chrome.tabs.get(${nav.tab.id})`),permission:await control.evaluate(`chrome.permissions.contains({origins:[${JSON.stringify(`http://127.0.0.2:${port}/*`)}]})`)};return snapshot.state==='PAUSED'&&/未授权/.test(snapshot.notice??'');},'ungranted navigation pauses');
        release('nav');await pause(150);
        const deniedResume=await control.evaluate(`chrome.runtime.sendMessage({type:'VV_RESUME_SESSION',tab_id:${nav.tab.id}})`);
        if(deniedResume.ok||(await state(nav.tab.id)).state!=='PAUSED')throw new Error('Unauthorized resume accepted or late response resumed the task');
        await control.evaluate(`chrome.tabs.update(${nav.tab.id},{url:${JSON.stringify(nav.url)}})`);await pause(300);
        if((await state(nav.tab.id)).state!=='PAUSED')throw new Error('Navigation back automatically resumed a paused task');
        await send({type:'VV_RESUME_SESSION',tab_id:nav.tab.id});
        await waitFor(async()=> (await state(nav.tab.id)).state==='COMPLETE','explicit resume on authorized site');
        await send({type:'VV_CLEAR_SESSION',tab_id:nav.tab.id});
        item.checks.push('unauthorized_navigation_pause/late_response_blocked/permission_required_resume/authorized_explicit_resume');
        item.retained_tasks=2;item.passed=true;
      }catch(error){item.error=error.message;}
      console.log(name,'lifecycle passed',item.passed,'error',item.error);
    }
    if(timerTests) {
      result.timer=[];
      const timerPanel=(await cdp.send('Target.createTarget',{url:`chrome-extension://${extensionId}/tasks.html`})).targetId;
      await pause(200);
      const timerCases=['shortened','stalled','media-shortened'].flatMap(kind=>['supervised','unattended'].map(strategy=>({id:`${kind}-${strategy}`,kind,strategy})));
      await Promise.all(timerCases.map(async({id,kind,strategy})=>{
        const item={id,strategy,passed:false,error:null};result.timer.push(item);
        try {
          const original=profiles.find(p=>p.provider_type==='openai_compatible');
          const mediaCase=kind==='media-shortened';
          const p={...original,provider_profile_id:`timer-${id}`,secret_ref:`timer-${id}`,base_url:`http://127.0.0.1:${port}/${name}/openai_compatible/timer-${id}/v1`,capabilities:{...original.capabilities,image_input:mediaCase},image_upload_authorized:mediaCase};
          await control.evaluate(`chrome.storage.local.set(${JSON.stringify({[`provider-profile:${p.provider_profile_id}`]:p,[`provider-secret:${p.secret_ref}`]:'local-fixture-only'})})`);
          const url=`http://${strategy==='supervised'?'localhost':'127.0.0.1'}:${port}/timer/${name}/${id}`;
          const tab=await control.evaluate(`chrome.tabs.create({url:${JSON.stringify(url)},active:false})`);await pause(300);
          const start=await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({type:'VV_START_SESSION',tab_id:tab.id,provider_profile_id:p.provider_profile_id,model_id:p.model_catalog.models[0],strategy,model_call_limit:3,observation_input_mode:'structured'})})`);
          if(!start.ok)throw new Error(start.error);
          const held=mediaCase?heldMedia:heldTimers;const holdKey=mediaCase?`/slow-media/${name}/${id}.png`:`${name}:${id}`;
          for(let i=0;i<300&&!held.has(holdKey);i++)await pause(30);
          if(!held.has(holdKey)){item.snapshot=(await control.evaluate(`chrome.runtime.sendMessage({type:'VV_GET_SESSION',tab_id:${tab.id}})`)).result;throw new Error('Timer media/model request was not held');}
          const states=[];
          if(kind.includes('shortened'))await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id}},func:()=>{const timer=document.querySelector('[role=timer]');timer.setAttribute('data-remaining-seconds','1');timer.textContent='1';}})`);
          for(let i=0;i<200;i++){item.snapshot=(await control.evaluate(`chrome.runtime.sendMessage({type:'VV_GET_SESSION',tab_id:${tab.id}})`)).result;states.push(item.snapshot?.state);if(['COMPLETE','PAUSED','FAILED','CANCELLED'].includes(item.snapshot?.state))break;await pause(50);}
          item.states=[...new Set(states)];
          const read=async()=>{const [page]=await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id}},world:'MAIN',func:()=>({text:document.body.innerText,submissions:window.submissions,visibility:document.visibilityState})})`);return page?.result;};
          item.website=await read();
          held.get(holdKey)?.();held.delete(holdKey);await pause(100);
          item.after_late_answer=(await control.evaluate(`chrome.runtime.sendMessage({type:'VV_GET_SESSION',tab_id:${tab.id}})`)).result;
          item.website_after_late_answer=await read();
          item.all_notification_requests=await control.evaluate(readTestNotices);
          item.close_out_notices=item.all_notification_requests.filter(notice=>notice.id.startsWith(`vv-${tab.id}-`)&&notice.title==='VV 正在收尾');
          item.passed=item.snapshot?.state==='COMPLETE'&&item.snapshot.progress.answered===0&&item.snapshot.progress.skipped===2&&item.snapshot.model_calls.used===(mediaCase?0:1)&&item.website?.submissions===1&&item.website.text.includes('0 out of 2')&&item.after_late_answer.state==='COMPLETE'&&item.website_after_late_answer.submissions===1&&item.website.visibility==='hidden';
          if(!item.passed)throw new Error('Close-out did not preserve blank answers, single submission, late response isolation and hidden state');
          if(item.close_out_notices.length!==(strategy==='supervised'?1:0)) {item.passed=false;throw new Error('Close-out notice was missing, duplicated or sent for unattended mode');}
        }catch(error){item.error=error.message;}
        console.log(name,'timer',id,'passed',item.passed,'error',item.error);
      }));
      await cdp.send('Target.closeTarget',{targetId:timerPanel});
    }
    if (settingsTests) {
      const item = result.settings = { passed: false, error: null };
      try {
        await control.evaluate("location.reload();true");
        for(let i=0;i<100;i++){if(await control.evaluate("document.querySelectorAll('.profile-card').length===3"))break;await pause(50);}
        // Permission handling is not under test; only this owned test page is stubbed.
        await control.evaluate(`chrome.permissions.request=async()=>true;document.querySelectorAll('.profile-card')[0].querySelector('button').click();document.querySelector('#batch-model').value='gemini-3.8-flash';document.querySelector('#batch-model').dispatchEvent(new Event('change'));document.querySelector('#batch-custom').checked=true;document.querySelector('#batch-custom').dispatchEvent(new Event('change'));document.querySelector('#batch-questions').value='2';document.querySelector('#batch-tokens').value='4000';document.querySelector('#batch-images').value='2';document.querySelector('#provider-form').requestSubmit();true`);
        for(let i=0;i<100;i++) {
          item.saved = await control.evaluate("chrome.storage.local.get('provider-profile:google').then(x=>x['provider-profile:google'])");
          if(item.saved.model_batch_limits?.['gemini-3.8-flash']?.max_questions===2)break;
          await pause(50);
        }
        if(item.saved.model_catalog.input_token_limits?.['gemini-3.8-flash']!==8192)throw new Error("Settings did not persist Google input metadata");
        // Set the second model while retaining the first, then reload persisted settings.
        await control.evaluate(`document.querySelector('#batch-model').value='gemini-3.1-pro';document.querySelector('#batch-model').dispatchEvent(new Event('change'));document.querySelector('#batch-custom').checked=true;document.querySelector('#batch-custom').dispatchEvent(new Event('change'));document.querySelector('#batch-questions').value='3';document.querySelector('#batch-tokens').value='5000';document.querySelector('#batch-images').value='1';document.querySelector('#provider-form').requestSubmit();true`);
        for(let i=0;i<100;i++){item.saved=await control.evaluate("chrome.storage.local.get('provider-profile:google').then(x=>x['provider-profile:google'])");if(item.saved.model_batch_limits?.['gemini-3.1-pro']?.max_questions===3)break;await pause(50);}
        if(item.saved.model_batch_limits?.['gemini-3.8-flash']?.max_questions!==2)throw new Error("Switching model lost the earlier override");
        await control.evaluate("location.reload();true");
        for(let i=0;i<100;i++){if(await control.evaluate("document.querySelectorAll('.profile-card').length===3"))break;await pause(50);}
        item.reloaded=await control.evaluate(`(()=>{document.querySelectorAll('.profile-card')[0].querySelector('button').click();const select=document.querySelector('#batch-model');select.value='gemini-3.1-pro';select.dispatchEvent(new Event('change'));return {custom:document.querySelector('#batch-custom').checked,questions:document.querySelector('#batch-questions').value,tokens:document.querySelector('#batch-tokens').value,images:document.querySelector('#batch-images').value}})()`);
        if(!item.reloaded.custom||item.reloaded.questions!=='3'||item.reloaded.tokens!=='5000'||item.reloaded.images!=='1')throw new Error("Saved model limits did not reload into form");
        await control.send("Emulation.setDeviceMetricsOverride",{width:900,height:1300,deviceScaleFactor:1,mobile:false});
        const screenshot=await control.send("Page.captureScreenshot",{format:"png"});
        await writeFile(resolve(directory,`${name}-settings.png`),Buffer.from(screenshot.data,"base64"));
        const tab=await control.evaluate(`chrome.tabs.create({url:'http://localhost:${port}/whole/${name}',active:false})`);
        await pause(300);
        const start=await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({type:"VV_START_SESSION",tab_id:tab.id,provider_profile_id:"google",model_id:"gemini-3.8-flash",strategy:"unattended",model_call_limit:6,observation_input_mode:"structured"})})`);
        if(!start.ok)throw new Error(start.error);
        for(let i=0;i<400;i++){item.snapshot=(await control.evaluate(`chrome.runtime.sendMessage({type:"VV_GET_SESSION",tab_id:${tab.id}})`)).result;if(['COMPLETE','FAILED','PAUSED','CANCELLED'].includes(item.snapshot?.state))break;await pause(100);}
        const [page]=await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id}},world:'MAIN',func:()=>({text:document.body.innerText,submissions:window.submissions})})`);
        item.website=page?.result;
        item.passed=item.snapshot?.state==='COMPLETE'&&item.snapshot.progress.answered===6&&item.snapshot.model_calls.used===3&&item.website?.submissions===1&&item.website.text.includes('6 out of 6');
        if(!item.passed)throw new Error("Six-question page did not use three batches and one verified submission");
      } catch(error){item.error=error.message;item.passed=false;}
      console.log(name,'settings and model batches passed',item.passed,'error',item.error);
    }
    if (budgetTests) await runBudgetCases({ name, port, profiles, control, cdp, extensionId, result, directory, writeFile, resolve, requests: report.requests, notices: readTestNotices });
    const jobs = [{ type: "google", search: false }, { type: "anthropic", search: false },
      { type: "anthropic", search: true }, { type: "openai_compatible", search: false }];
    await Promise.all(jobs.map(async job => {
      const item = { ...job, snapshot: null, website: null, error: null };
      result.results.push(item);
      try {
        const host = job.type === "google" ? "localhost" : "127.0.0.1";
        const tab = await control.evaluate(`chrome.tabs.create({url:"http://${host}:${port}/quiz/${name}/${job.type}/${job.search}",active:false})`);
        await pause(300);
        const profile = profiles.find(profile => profile.provider_type === job.type);
        const request = { type: "VV_START_SESSION", tab_id: tab.id, provider_profile_id: job.type,
          model_id: profile.model_catalog.models[0], strategy: "unattended", model_call_limit: 3,
          observation_input_mode: "structured", allow_native_search: job.search };
        const started = await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(request)})`);
        if (!started.ok) throw new Error(started.error);
        const deadline = Date.now() + 40000;
        do {
          const answer = await control.evaluate(`chrome.runtime.sendMessage({type:"VV_GET_SESSION",tab_id:${tab.id}})`);
          if (!answer.ok) throw new Error(answer.error);
          item.snapshot = answer.result;
          if (["COMPLETE", "FAILED", "PAUSED", "CANCELLED"].includes(item.snapshot?.state)) break;
          await pause(100);
        } while (Date.now() < deadline);
        const [page] = await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id}},func:()=>({url:location.href,text:document.body.innerText})})`);
        item.website = page?.result;
        item.passed = item.snapshot?.state === "COMPLETE" && item.snapshot.progress.answered === 1 &&
          item.snapshot.model_calls.used === (job.search ? 2 : 1) && item.website?.text.includes("You got 1 out of 1 points");
      } catch (error) { item.error = error.message; item.passed = false; }
      console.log(name, job.type, "search", job.search, "passed", item.passed, "error", item.error);
    }));
    if (interactionTests) {
      result.interaction = [];
      let ownedInputQueue = Promise.resolve();
      // Keep three tasks live together; each operates a separate page/origin.
      await Promise.all([
        { id: "main", host: "localhost", layout: "main", strategy: "unattended" },
        { id: "iframe", host: "127.0.0.1", layout: "iframe", strategy: "unattended" },
        { id: "supervised", host: "127.0.0.1", layout: "fill", strategy: "supervised" },
        { id: "closed", host: "localhost", layout: "closed", strategy: "unattended" },
      ].map(async job => {
        const item = { ...job, passed: false, error: null };
        result.interaction.push(item);
        try {
          const profileId = `manual-${job.id}`;
          const original = profiles.find(profile => profile.provider_type === "openai_compatible");
          const profile = { ...original, provider_profile_id: profileId, secret_ref: profileId,
            ...(job.layout === "closed" ? { capabilities: { ...original.capabilities, image_input: true }, image_upload_authorized: true } : {}),
            base_url: `http://127.0.0.1:${port}/${name}/openai_compatible/manual-${job.id}/v1` };
          await control.evaluate(`chrome.storage.local.set(${JSON.stringify({ [`provider-profile:${profileId}`]: profile, [`provider-secret:${profileId}`]: "local-fixture-only" })})`);
          const url = `http://${job.host}:${port}/manual/${job.layout}?case=${job.id}`;
          const tab = await control.evaluate(`chrome.tabs.create({url:${JSON.stringify(url)},active:false})`);
          item.url = url;
          const tabTarget = (await cdp.send("Target.getTargets")).targetInfos.find(target => target.type === "page" && target.url === url);
          const page = await cdp.attach(tabTarget.targetId);
          await pause(350);
          const start = await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({ type: "VV_START_SESSION", tab_id: tab.id,
            provider_profile_id: profileId, model_id: profile.model_catalog.models[0], strategy: job.strategy,
            model_call_limit: 10, observation_input_mode: job.layout === "closed" ? "visual_snapshot" : "structured" })})`);
          if (!start.ok) throw new Error(start.error);
          const snapshot = async () => (await control.evaluate(`chrome.runtime.sendMessage({type:"VV_GET_SESSION",tab_id:${tab.id}})`)).result;
          const waitState = async (states, timeout = 12000) => {
            const deadline = Date.now() + timeout;
            do {
              const value = await snapshot();
              if (states.includes(value?.state)) return value;
              await pause(30);
            } while (Date.now() < deadline);
            throw new Error(`State did not reach ${states.join("/")}: ${(await snapshot())?.state}`);
          };
          const heldState = job.layout === "closed" ? "OBSERVE_SESSION" : "SOLVE";
          await waitState([heldState], job.layout === "closed" ? 30000 : 12000);
          if(job.layout === "closed") {
            const deadline=Date.now()+20000;
            while(!heldAnswers.has(`${name}:${job.id}`)&&Date.now()<deadline)await pause(30);
            if(!heldAnswers.has(`${name}:${job.id}`))throw new Error("Initial visual recognition was not held");
          }
          const previousInput = ownedInputQueue;
          let releaseInput;
          ownedInputQueue = new Promise(resolve => { releaseInput = resolve; });
          await previousInput;
          try {
          // Only our hidden page is activated; native OS input is never used.
          await page.send("Page.bringToFront");
          // A trusted click outside the question must leave solving intact.
          const menu = await page.evaluate('(()=>{const r=document.querySelector("#menu").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
          await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...menu });
          await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...menu });
          item.after_outside_click = (await snapshot()).state;
          if (item.after_outside_click !== heldState) throw new Error("Outside click paused or prematurely completed the quiz");
          if (job.layout === "fill") {
            await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id}},func:()=>document.querySelector('input').focus()})`);
            await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "x", code: "KeyX", text: "x", windowsVirtualKeyCode: 88 });
            await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "x", code: "KeyX", windowsVirtualKeyCode: 88 });
          } else if (job.layout === "closed") {
            const rect=await page.evaluate("window.canvasBounds()");
            const point={x:rect.x+190,y:rect.y+70};
            item.closed_root=await page.evaluate("document.querySelector('closed-quiz').shadowRoot===null");
            await page.send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
            await page.send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
          } else {
          // Locate the actual option, including the cross-origin iframe offset.
          const coordinates = await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id},allFrames:true},func:()=>{
            const e=document.querySelector('input[value="b"]');if(!e)return null;
            const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}})`);
          let point = coordinates.find(value => value.result)?.result;
          if (!point) throw new Error("Manual option not found");
          if (job.layout === "iframe") {
            const offset = await page.evaluate('(()=>{const e=document.querySelector("iframe"),r=e.getBoundingClientRect();return {x:r.x+e.clientLeft,y:r.y+e.clientTop}})()');
            point = { x: point.x + offset.x, y: point.y + offset.y };
          }
          item.click_point = point;
          item.hit_target = await page.evaluate(`(()=>{const e=document.elementFromPoint(${point.x},${point.y});return {tag:e?.tagName,viewport:{width:innerWidth,height:innerHeight},iframe:document.querySelector('iframe')?.getBoundingClientRect().toJSON()}})()`);
          const beforeImage = await page.send("Page.captureScreenshot", { format: "png" });
          await writeFile(resolve(directory, `${name}-manual-${job.id}-before.png`), Buffer.from(beforeImage.data, "base64"));
          await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
          await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
          }
          } finally { releaseInput(); }
          item.paused_snapshot = await waitState(["PAUSED", "FAILED", "COMPLETE"]);
          releaseManual(name, job.id);
          await pause(200);
          const states = await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id},allFrames:true},world:"MAIN",func:()=>{
            if(window.canvasState)return {beta:canvasState.selected==='b',alpha:canvasState.selected==='a'};
            const e=document.querySelector('input[value="b"]');if(e)return {beta:e.checked,alpha:document.querySelector('input[value="a"]').checked};
            const text=document.querySelector('input[type="text"]');return text?{value:text.value}:null;}})`);
          item.after_late_answer = await snapshot();
          item.selection = states.find(value => value.result)?.result;
          if (item.paused_snapshot.state !== "PAUSED" || !item.paused_snapshot.notice.includes("点击或输入") ||
            item.after_late_answer.state !== "PAUSED" || (job.layout === "fill" ? item.selection?.value !== "x" : item.selection?.beta !== true || item.selection.alpha !== false)) {
            throw new Error("Manual pause did not preserve the actual user selection");
          }
          let resumed;
          for (let attempt = 0; attempt < 100; attempt++) {
            resumed = await control.evaluate(`chrome.runtime.sendMessage({type:"VV_RESUME_SESSION",tab_id:${tab.id}})`);
            if (resumed.ok) break;
            if (!resumed.error.includes("正在完成暂停")) throw new Error(resumed.error);
            await pause(50);
          }
          if (!resumed?.ok) throw new Error("Paused task never settled");
          item.resumed_snapshot = await waitState(["COMPLETE", "FAILED", "PAUSED"], job.layout === "closed" ? 40000 : 12000);
          item.passed = item.resumed_snapshot.state === "COMPLETE" && item.resumed_snapshot.progress.answered === 1;
          if (!item.passed) throw new Error(`Resume failed: ${item.resumed_snapshot.notice}`);
        } catch (error) { item.error = error.message; }
        finally { releaseManual(name, job.id); }
        console.log(name, "manual", job.id, "passed", item.passed, "error", item.error);
      }));
    }
    if (visualTests) {
      result.visual = [];
      const visualJobs = ["single", "multi", "fill"].flatMap(kind => ["unattended", "supervised"].map(strategy => ({ kind, strategy })));
      await Promise.all(visualJobs.map(async ({ kind, strategy }) => {
        const item = { strategy, kind, passed: false, error: null };
        result.visual.push(item);
        try {
          const profileId = "visual-compatible";
          const profile = { ...profiles.find(profile => profile.provider_type === "openai_compatible"),
            provider_profile_id: profileId, secret_ref: profileId, capabilities: { image_input: true, structured_output: true, native_web_search: false }, image_upload_authorized: true };
          await control.evaluate(`chrome.storage.local.set(${JSON.stringify({ [`provider-profile:${profileId}`]: profile, [`provider-secret:${profileId}`]: "local-fixture-only" })})`);
          const url = `http://${strategy === "supervised" ? "localhost" : "127.0.0.1"}:${port}/canvas/${name}/${strategy}/${kind}`;
          item.url = url;
          const tab = await control.evaluate(`chrome.tabs.create({url:${JSON.stringify(url)},active:false})`);
          await pause(300);
          const request = { type: "VV_START_SESSION", tab_id: tab.id, provider_profile_id: profileId, model_id: profile.model_catalog.models[0],
            strategy, model_call_limit: 20, observation_input_mode: "visual_snapshot" };
          const start = await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(request)})`);
          if (!start.ok) throw new Error(start.error);
          const deadline = Date.now() + 90000;
          do {
            // This option only rotates tabs inside our own headless browser.
            // It does not activate any user browser or prove inactive-tab capture.
            if (visualActiveTests) await control.evaluate(`chrome.tabs.update(${tab.id},{active:true})`);
            item.snapshot = (await control.evaluate(`chrome.runtime.sendMessage({type:"VV_GET_SESSION",tab_id:${tab.id}})`)).result;
            if (["COMPLETE", "PAUSED", "FAILED", "CANCELLED"].includes(item.snapshot?.state)) break;
            await pause(100);
          } while (Date.now() < deadline);
          const [state] = await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id}},world:"MAIN",func:()=>({state:window.canvasState,active:document.visibilityState,url:location.href})})`);
          item.website = state.result;
          item.passed = item.snapshot?.state === "COMPLETE" && item.snapshot.progress.answered === 1 && item.website.state.completed &&
            item.website.state?.events.length === (kind === "fill" ? 9 : kind === "multi" ? 3 : 2) && item.website.state.events.every(event => event.trusted);
          if (!item.passed) item.error = item.snapshot?.notice ?? "Visual completion or native event evidence missing";
        } catch (error) { item.error = error.message; }
        console.log(name, "canvas", kind, strategy, "passed", item.passed, "error", item.error);
      }));
    }
    const expectedCards = jobs.length + (lifecycleTests ? result.lifecycle?.retained_tasks??0 : 0) + (settingsTests ? 1 : 0) + (timerTests ? 6 : 0) + (interactionTests ? 4 : 0) + (visualTests ? 6 : 0);
    const panelTarget = (await cdp.send("Target.createTarget", { url: `chrome-extension://${extensionId}/tasks.html` })).targetId;
    const panel = await cdp.attach(panelTarget);
    for (let attempt = 0; attempt < 50; attempt++) {
      result.panel = await panel.evaluate('({cards:document.querySelectorAll(".task").length,error:document.querySelector("#error")?.textContent})');
      if (result.panel.cards === expectedCards) break;
      await pause(100);
    }
    const image = await panel.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(resolve(directory, `${name}-tasks.png`), Buffer.from(image.data, "base64"));
  } catch (error) { result.errors.push(error.message); }
  finally {
    if (cdp) { try { await cdp.send("Browser.close"); } catch { if (child.exitCode === null) child.kill(); } cdp.close?.(); }
    else if (child.exitCode === null) child.kill();
    result.stderr_tail = stderr.join("").slice(-1200);
    result.passed = result.extension_loaded && result.results.length === 4 && result.results.every(item => item.passed) && result.errors.length === 0 && result.panel?.cards === (4 + (lifecycleTests ? result.lifecycle?.retained_tasks??0 : 0) + (settingsTests ? 1 : 0) + (timerTests ? 6 : 0) + (interactionTests ? 4 : 0) + (visualTests ? 6 : 0)) && !result.panel.error && (!panelTests||result.panel_actions?.passed) && (!lifecycleTests || result.lifecycle?.passed) && (!budgetTests || result.budget?.length === 4 && result.budget.every(item=>item.passed)) && (!timerTests || result.timer?.every(item=>item.passed)) && (!settingsTests || result.settings?.passed) && (!interactionTests || result.interaction?.every(item => item.passed)) && (!visualTests || result.visual?.every(item => item.passed));
  }
}

try {
  await mkdir(directory, { recursive: true });
  console.log("REPORT_DIRECTORY", directory);
  const build = spawnSync(process.execPath, [resolve(root, "scripts/build.mjs")], { cwd: root, env: { ...process.env, VV_BUILD_DIR: extension }, stdio: "inherit" });
  if (build.status !== 0) throw new Error("Isolated MV3 build failed");
  const manifest = JSON.parse(await readFile(resolve(extension, "manifest.json"), "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*", "http://localhost/*"];
  await writeFile(resolve(extension, "manifest.json"), JSON.stringify(manifest, null, 2));
  // Only the owned test build records notifications. Every worker instance uses
  // the same session store; no runtime API monkey patch or OS toast is involved.
  await installTestNotificationRecorder(extension);
  report.notification_delivery='private_build_recording_only_no_os_notifications';
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await Promise.all([
    runBrowser("chrome", resolve(root, ".browser-regression-runtime/chrome-cft/chrome-win64/chrome.exe"), port),
    runBrowser("edge", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", port),
  ]);
  if (report.browsers.some(browser => !browser.passed)) process.exitCode = 1;
} catch (error) { report.errors.push(error.message); process.exitCode = 1; }
finally {
  for (const release of heldAnswers.values()) release();
  for (const release of heldTimers.values()) release();
  for (const release of heldMedia.values()) release();
  for (const release of heldLife.values()) release();
  server.close();
  report.finished_at = new Date().toISOString();
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log("FINAL", JSON.stringify({ directory, browsers: report.browsers.map(browser => ({ name: browser.name, passed: browser.passed, errors: browser.errors, results: browser.results.map(item => ({ type: item.type, search: item.search, state: item.snapshot?.state, passed: item.passed, error: item.error })) })), errors: report.errors }));
}
