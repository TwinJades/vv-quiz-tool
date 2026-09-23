const base = `http://127.0.0.1:${process.argv[3] ?? 9341}`;
const site = process.argv[2];
const sampleQuestions = Number(process.argv[5] ?? 0);
if (!["frontend", "quizzy", "w3c", "generic", "separation", "separation_controls", "inspect", "quizzyprobe", "w3probe", "reload", "models"].includes(site)) throw new Error("Unknown regression target");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method) this.events.push(message);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("CDP target closed"));
      this.pending.clear();
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return result;
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function get(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

if (site === "inspect") {
  const target = await get(`/json/new?${encodeURIComponent("edge://extensions")}`, { method: "PUT" });
  const page = new Cdp(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await sleep(1000);
  await page.evaluate(`(()=>{const root=document.querySelector('root-app')?.shadowRoot;const side=root?.querySelector('side-nav-pane')?.shadowRoot;const profile=side?.querySelector('profile-toggles')?.shadowRoot;const toggle=profile?.querySelector('developer-mode-switch')?.shadowRoot?.querySelector('fluent-switch');if(!toggle?.checked)toggle?.click();return true})()`);
  await sleep(500);
  await page.send("Page.setInterceptFileChooserDialog", { enabled: true });
  console.log(await page.evaluate(`(()=>{const root=document.querySelector('root-app')?.shadowRoot;const header=root?.querySelector('my-extension-page')?.shadowRoot?.querySelector('developer-mode-options-header')?.shadowRoot;const button=header?.querySelector('#big-screen-buttons fluent-button[title="加载解压缩的扩展"]');button?.click();return {buttonFound:!!button}})()`));
  await sleep(500);
  console.log(page.events.filter((event) => /fileChooser|dialog|targetCreated/i.test(event.method)).map((event) => ({method:event.method,params:event.params})));
  page.close();
  process.exit(0);
}

if (site === "quizzyprobe") {
  const targets = await get("/json/list");
  const target = targets.find((item) => item.type === "page" && item.url.includes("quizzydaily.com"));
  if (!target) throw new Error("QuizzyDaily target missing");
  const page = new Cdp(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Page.navigate", { url: "https://www.quizzydaily.com/quiz/food-drink/food-and-drink-tasty-trivia" });
  await sleep(2000);
  console.log(await page.evaluate(`({url:location.href,text:document.body.innerText.slice(0,3000),controls:[...document.querySelectorAll('button,input,a')].map(a=>({tag:a.tagName,text:a.textContent?.trim().slice(0,80),type:a.type,href:a.href})).filter(a=>/start|play|name|quiz/i.test(a.text??'')).slice(0,30)})`));
  page.close();
  process.exit(0);
}

if (site === "w3probe") {
  const target = (await get("/json/list")).find((item) => item.type === "page" && item.url.includes("w3schools.com/quiztest/quiztest.php"));
  if (!target) throw new Error("W3Schools target missing");
  const page = new Cdp(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  console.log(await page.evaluate(`({url:location.href,title:document.title,text:document.body?.innerText.slice(-1800),controls:[...document.querySelectorAll('input,button,form')].slice(-24).map(e=>({tag:e.tagName,type:e.type,name:e.name,text:e.textContent?.trim().slice(0,80)}))})`));
  const extensionTarget = (await get("/json/list")).find((item) => item.url.includes("chrome-extension://denncmmiepljpbohhclcjcdjondnfgco/"));
  if (extensionTarget) {
    const extension = new Cdp(extensionTarget.webSocketDebuggerUrl);
    await extension.send("Runtime.enable");
    console.log("STATE", JSON.stringify(await extension.evaluate(`(async()=>{const tabs=await chrome.tabs.query({url:'https://www.w3schools.com/quiztest/*'});return Promise.all(tabs.map(async tab=>({id:tab.id,url:tab.url,status:tab.status,state:await chrome.tabs.sendMessage(tab.id,{type:'VV_READ_STATE'},{frameId:0}).catch(e=>String(e)),observation:await chrome.tabs.sendMessage(tab.id,{type:'VV_OBSERVE',session_id:'probe',mode:'structured'},{frameId:0}).catch(e=>String(e))})))})()`)));
    extension.close();
  }
  page.close();
  process.exit(0);
}

if (site === "reload") {
  const target = (await get("/json/list")).find((item) => item.url.includes("chrome-extension://denncmmiepljpbohhclcjcdjondnfgco/"));
  if (!target) throw new Error("VV extension target missing");
  const page = new Cdp(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.evaluate("setTimeout(() => chrome.runtime.reload(), 100); true");
  page.close();
  process.exit(0);
}

const extensionTarget = (await get("/json/list")).find((target) => target.url.includes("chrome-extension://denncmmiepljpbohhclcjcdjondnfgco/"))
  ?? await get(`/json/new?${encodeURIComponent("chrome-extension://denncmmiepljpbohhclcjcdjondnfgco/options.html")}`, { method: "PUT" });
if (!extensionTarget) throw new Error("VV extension target missing");
const extensionId = new URL(extensionTarget.url).host;
const controlTarget = await get(`/json/new?${encodeURIComponent(`chrome-extension://${extensionId}/options.html`)}`, { method: "PUT" });
const control = new Cdp(controlTarget.webSocketDebuggerUrl);
await control.send("Runtime.enable");
const extEval = (body) => control.evaluate(`(async()=>{${body}})()`);
for (let count = 0; count < 100; count += 1) {
  if (await control.evaluate(`typeof chrome?.storage?.local !== "undefined"`)) break;
  await sleep(100);
}
const provider = await extEval(`
  const stored=await chrome.storage.local.get(null);
  const id=(stored["provider-profile-index"]??[]).find((candidate)=>stored["provider-profile:"+candidate]?.display_name==="CPA");
  if(!id)throw new Error("CPA Provider missing in isolated profile");
  const profile=stored["provider-profile:"+id];
  return {id,models:profile.model_catalog.models};
`);
if (site === "models") {
  console.log(provider.models);
  control.close();
  process.exit(0);
}
const modelId = process.argv[4] ?? "gemini-3.8-flash-high";
if (!provider.models.includes(modelId)) throw new Error(`Configured model is missing: ${modelId}`);

async function createTab(url) {
  return extEval(`
    if(${sampleQuestions > 0}){const tab=await chrome.tabs.create({url:${JSON.stringify(url)},active:false});return {id:tab.id,url:tab.url};}
    const existing=(await chrome.tabs.query({})).find((candidate)=>candidate.url?.startsWith(${JSON.stringify(url)}));
    if(existing)return {id:existing.id,url:existing.url};
    const tab=await chrome.tabs.create({url:${JSON.stringify(url)},active:false});
    return {id:tab.id,url:tab.url};
  `);
}

async function pageEval(tabId, funcSource) {
  return extEval(`
    const result=await chrome.scripting.executeScript({target:{tabId:${tabId}},func:${funcSource}});
    return result[0]?.result;
  `);
}

async function startAndWait(tabId, minimumAnswered, requireComplete) {
  await extEval(`
    const send=(message)=>chrome.runtime.sendMessage(message).then((response)=>{if(!response?.ok)throw new Error(response?.error);return response.result});
    const previous=await send({type:"VV_GET_SESSION",tab_id:${tabId}});
    if(previous && ["PAUSED","FAILED","COMPLETE","CANCELLED"].includes(previous.state))await send({type:"VV_CLEAR_SESSION",tab_id:${tabId}});
    const request={type:"VV_START_SESSION",tab_id:${tabId},provider_profile_id:${JSON.stringify(provider.id)},model_id:${JSON.stringify(modelId)},strategy:"unattended",model_call_limit:60,observation_input_mode:"semantic_snapshot"};
    await send({type:"VV_ARM_SESSION_START",start_request:request,required_origins:[${JSON.stringify(
      site === "frontend" ? "https://www.frontend.beauty/*" : site === "quizzy" ? "https://www.quizzydaily.com/*" : site === "generic" ? `${new URL(process.argv[6]).origin}/*` : "https://www.w3schools.com/*",
    )}]});
    return send({type:"VV_COMMIT_SESSION_START",tab_id:${tabId}});
  `);
  let snapshot;
  let lastMarker = "";
  for (let count = 0; count < 1_600; count += 1) {
    snapshot = await extEval(`const response=await chrome.runtime.sendMessage({type:"VV_GET_SESSION",tab_id:${tabId}});return response.result;`);
    const marker = JSON.stringify({ state: snapshot?.state, progress: snapshot?.progress, calls: snapshot?.model_calls, notice: snapshot?.notice });
    if (marker !== lastMarker && (snapshot?.progress?.answered !== undefined || snapshot?.notice)) {
      lastMarker = marker;
      console.log(marker);
    }
    const terminal = ["PAUSED", "FAILED", "COMPLETE"].includes(snapshot?.state);
    if (terminal || (!requireComplete && snapshot?.progress?.answered >= minimumAnswered && (sampleQuestions > 0 ? snapshot.state === "WAIT_READY" : (!["w3c", "separation_controls"].includes(site) || snapshot.state !== "ADVANCE")))) break;
    await sleep(500);
  }
  if (!requireComplete && !["PAUSED", "FAILED", "COMPLETE"].includes(snapshot?.state)) {
    await extEval(`await chrome.runtime.sendMessage({type:"VV_STOP_SESSION",tab_id:${tabId}});return true;`);
  }
  return snapshot;
}

let tab;
let minimumAnswered;
let requireComplete;
if (site === "frontend") {
  tab = await createTab("https://www.frontend.beauty/test-me");
  await sleep(2_000);
  const clicked = await pageEval(tab.id, `()=>{const node=[...document.querySelectorAll('button,a')].find((item)=>/begin interview/i.test(item.textContent));if(!node)return false;node.click();return true}`);
  if (!clicked) throw new Error("Frontend Beauty start control missing");
  for (let count = 0; count < 150; count += 1) {
    const current = await extEval(`return chrome.tabs.get(${tab.id})`);
    if (current.url?.includes("/test-me/session")) break;
    await sleep(100);
  }
  await sleep(1_500);
  minimumAnswered = 15;
  requireComplete = true;
} else if (site === "quizzy") {
  tab = await createTab("https://www.quizzydaily.com/quiz/food-drink");
  await sleep(2_000);
  const opened = await pageEval(tab.id, `()=>{const link=[...document.querySelectorAll('a[href]')].find((node)=>node.href.endsWith('/quiz/food-drink/food-and-drink-tasty-trivia'));if(!link)return false;link.click();return true}`);
  if (!opened) throw new Error("QuizzyDaily food quiz link missing");
  let quizStarted = false;
  for (let attempt = 0; attempt < 20 && !quizStarted; attempt += 1) {
    await sleep(1_000);
    const state = await pageEval(tab.id, `()=>{
      const input=document.querySelector('input[type="text"]');
      const start=[...document.querySelectorAll('button')].find((node)=>/start quiz/i.test(node.textContent));
      if(input&&start){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'VV Regression');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));if(!start.disabled)start.click();}
      return {url:location.href,input:!!input,button:!!start,disabled:start?.disabled??null,question:/question\\s+1\\s*(?:of|\\/)/i.test(document.body.innerText)};
    }`);
    quizStarted = Boolean(state?.question || (state?.url?.includes("/play/") && !state?.button));
    if (attempt === 19) console.log("QUIZZY_START", state);
  }
  if (!quizStarted) throw new Error("QuizzyDaily quiz did not start after entering display name.");
  minimumAnswered = 10;
  requireComplete = true;
} else if (site === "separation" || site === "separation_controls") {
  tab = await extEval(`const tab=await chrome.tabs.create({url:"https://www.w3schools.com/robots.txt",active:false});return {id:tab.id};`);
  await sleep(2_000);
  await pageEval(tab.id, `()=>{
    let question=0;
    const nextLabel=${JSON.stringify(site === "separation_controls" ? "Go to next question" : "Next ❯")};
    const items=[
      {stem:'Which language is compiled?',options:['C','CSS']},
      {stem:'Which language is interpreted?',options:['JavaScript','C']},
      {stem:'Which language is used for styling?',options:['CSS','C']},
    ];
    const render=()=>{
      const item=items[Math.min(question,items.length-1)];
      document.body.innerHTML='<main><section class="quiz-layout"><p>'+item.stem+'</p><div class="answers">'+item.options.map((label,index)=>'<label><input type="radio" name="q" value="'+index+'"> '+label+'</label>').join('')+'</div><button type="button">'+nextLabel+'</button></section></main>';
      document.querySelector('button').addEventListener('click',()=>{question++;render()});
    };
    render();
    return true;
  }`);
  minimumAnswered = 2;
  requireComplete = false;
} else if (site === "generic") {
  const targetUrl = process.argv[6];
  if (!targetUrl) throw new Error("Generic target URL missing");
  const origin = `${new URL(targetUrl).origin}/*`;
  const permission = await control.send("Runtime.evaluate", {
    expression: `Promise.race([chrome.permissions.request({origins:[${JSON.stringify(origin)}]}),new Promise(resolve=>setTimeout(()=>resolve(false),8000))])`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (!permission.result.value) throw new Error(`Website permission denied: ${origin}`);
  tab = await createTab(targetUrl);
  await sleep(2_000);
  minimumAnswered = 1;
  requireComplete = false;
} else {
  tab = await createTab("https://www.w3schools.com/quiztest/quiztest.php?qtest=C");
  let ready = false;
  for (let attempt = 0; attempt < 4 && !ready; attempt += 1) {
    await sleep(2_000);
    try {
      ready = Boolean(await pageEval(tab.id, `()=>/Question\\s+\\d+\\s+of\\s+25/i.test(document.body?.innerText??'')`));
    } catch {
      // A transient browser error page cannot host the content script.
    }
    if (!ready) await extEval(`await chrome.tabs.reload(${tab.id});return true;`);
  }
  if (!ready) throw new Error("W3Schools C question page unavailable");
  minimumAnswered = 5;
  requireComplete = false;
}

if (sampleQuestions > 0) { minimumAnswered = sampleQuestions; requireComplete = false; }
const runStartedAt = performance.now();
const snapshot = await startAndWait(tab.id, minimumAnswered, requireComplete);
const page = await pageEval(tab.id, `()=>({url:location.href,title:document.title,text:document.body.innerText.slice(-2500)})`);
if (snapshot?.timings?.length) {
  const total = snapshot.timings.reduce((sum, item) => sum + item.total_ms, 0);
  console.log("TIMINGS", JSON.stringify({
    wall_ms: Math.round(performance.now() - runStartedAt),
    stages: [...snapshot.timings]
      .sort((a, b) => b.total_ms - a.total_ms)
      .map((item) => ({ stage: item.stage, visits: item.visits, total_ms: item.total_ms, average_ms: Math.round(item.total_ms / item.visits), share_percent: Math.round(item.total_ms / total * 100) })),
  }));
}
if (snapshot?.steps?.length) {
  console.log("STEPS", JSON.stringify([...snapshot.steps]
    .sort((a, b) => b.total_ms - a.total_ms)
    .map((item) => ({ step: item.step, calls: item.calls, total_ms: item.total_ms, average_ms: Math.round(item.total_ms / item.calls), max_ms: item.max_ms }))));
}
console.log("FINAL", JSON.stringify({ site, snapshot, page }));
const failed = ["PAUSED", "FAILED"].includes(snapshot?.state) || snapshot?.progress?.failed > 0 || snapshot?.progress?.answered < minimumAnswered;
if (site === "separation" && snapshot?.model_calls.used !== 3) throw new Error("Expected one calibration and two answer calls.");
if (site === "separation_controls" && (snapshot?.model_calls.used !== 3 || !page?.text?.includes("Which language is used for styling?"))) {
  throw new Error("Expected one calibration, two answers, and verified navigation to the third question.");
}
if (site !== "generic" && sampleQuestions > 0 && !new RegExp(`Question\\s+${sampleQuestions + 1}\\s+(?:of|\\/)`, "i").test(page.text)) {
  throw new Error(`Expected navigation to question ${sampleQuestions + 1}.`);
}
if (failed || (requireComplete && snapshot?.state !== "COMPLETE")) throw new Error(`${site} regression failed`);
await extEval(`await chrome.tabs.remove(${tab.id});return true;`);
control.close();
