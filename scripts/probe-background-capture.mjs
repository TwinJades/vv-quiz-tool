import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CdpClient, cdpJson } from "./cdp-client.mjs";
import { canvasFixtureHtml } from "./canvas-fixture.mjs";
import { build } from "esbuild";

// Own headless browsers and local sites only; no user profiles or model calls.
const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, ".browser-regression-runtime", `capture-probe-${new Date().toISOString().replaceAll(":", "-")}`);
await mkdir(directory, { recursive: true });
const transportProbe = process.argv.includes("--transport");
const holdFocus = process.argv.includes("--hold-focus");
const historicalInput = process.argv.includes("--historical-input");
const frameProducer = process.argv.includes("--frame-producer");
const resultFrames = process.argv.includes("--result-frames");
const productionFrameProducer = (await readFile(resolve(root,"src/extension/visual-transport.ts"),"utf8")).includes('"Page.startScreencast"');
const extensionProbe = process.argv.includes("--extension") || transportProbe;
const extension = resolve(directory, "extension");
if (extensionProbe) {
  const built = spawnSync(process.execPath, [resolve(root, "scripts/build.mjs")], {
    cwd: root, env: { ...process.env, VV_BUILD_DIR: extension }, stdio: "inherit",
  });
  if (built.status !== 0) throw new Error("Isolated probe extension build failed");
  const manifestPath = resolve(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*", "http://localhost/*"];
  if (transportProbe) {
    // Test-only worker, built from the actual transport/content source. Never
    // changes the installed extension or adds a production diagnostic endpoint.
    await build({ stdin: { contents: `
      import { VisualTransport } from "./src/extension/visual-transport";
      ${holdFocus ? `const send=chrome.debugger.sendCommand.bind(chrome.debugger);
      chrome.debugger.sendCommand=(target,method,params)=>method==="Emulation.setFocusEmulationEnabled"&&params.enabled===false?Promise.resolve({}):send(target,method,params);` : ""}
      ${frameProducer && !productionFrameProducer ? `const command=chrome.debugger.sendCommand.bind(chrome.debugger);
      chrome.debugger.sendCommand=async(target,method,params)=>{
        if(method!=="Page.captureScreenshot")return command(target,method,params);
        await command(target,"Page.startScreencast",{format:"png",maxFramesInFlight:1});
        try{return await command(target,method,params);}
        finally{await command(target,"Page.stopScreencast",{}).catch(()=>{});}
      };
      chrome.debugger.onEvent.addListener((target,method,params)=>{
        if(method==="Page.screencastFrame")void command(target,"Page.screencastFrameAck",{sessionId:params.sessionId}).catch(()=>{});
      });` : ""}
      const transports = new Map();
      const frames = new Map();
      const bindings = new Map();
      async function content(tabId, request) {
        const answer = await chrome.tabs.sendMessage(tabId, request, {frameId:0});
        if (!answer.ok) throw new Error(answer.error);
        return answer.result;
      }
      chrome.runtime.onMessage.addListener((request, _sender, reply) => {
        if (request.type !== "PROBE_TRANSPORT") return;
        (async () => {
          const tabId = request.tabId;
          if (!transports.has(tabId)) {
            await chrome.scripting.executeScript({target:{tabId},files:["content.js"]});
            const binding = {session_id:"probe_"+tabId,epoch:crypto.randomUUID(),enabled:true};
            bindings.set(tabId,binding);
            await content(tabId,{type:"VV_SET_INTERACTION",binding});
            transports.set(tabId,new VisualTransport(tabId,
              ()=>content(tabId,{type:"VV_VISUAL_GEOMETRY"}),
              ()=>bindings.get(tabId),
              ticket=>content(tabId,{type:"VV_ARM_NATIVE_INPUT",ticket})));
          }
          const transport = transports.get(tabId);
          if(request.operation === "click") {
            await transport.click(request.point,new AbortController().signal,frames.get(tabId));
            return true;
          }
          if(request.operation === "text") {
            await transport.replaceText(request.value,new AbortController().signal,frames.get(tabId));
            return true;
          }
          const capture=await transport.capture("probe_"+tabId,crypto.randomUUID(),new AbortController().signal);
          frames.set(tabId,capture.frame);
          let binary="";
          for(const byte of capture.data) binary+=String.fromCharCode(byte);
          return {data:btoa(binary),frame:capture.frame};
        })().then(result=>reply({ok:true,result}),error=>reply({ok:false,error:error.message}));
        return true;
      });`, resolveDir: root, loader: "ts" }, bundle: true, format: "esm", target: "chrome120",
      outfile: resolve(extension, "probe-worker.js"),
      plugins: historicalInput ? [{ name: "probe-historical-input", setup(builder) {
        builder.onLoad({filter:/visual-transport\.ts$/},async args => ({loader:"ts",
          contents:(await readFile(args.path,"utf8")).replace("Date.now() + 10_000", "Date.now() - 10_000")}));
      } }] : [] });
    manifest.background.service_worker = "probe-worker.js";
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
const report = { directory, headless: true, parallel_sites: true, external_model_calls: 0, browsers: [] };
report.transport = transportProbe ? "product_visual_transport_worker" : extensionProbe ? "chrome.debugger" : "direct_cdp";
report.focus_held_for_owned_probe = holdFocus;
report.native_input_timestamp = historicalInput ? "historical_test_build" : "production";
report.temporary_frame_producer = frameProducer;
report.frame_producer_in_product = productionFrameProducer;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(canvasFixtureHtml(resultFrames&&request.url.endsWith('/fill')?"fill":"single"));
});
await new Promise(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
const port = server.address().port;
const cycleFocus = process.argv.includes("--focus-cycle");
report.focus_cycle = cycleFocus;

async function runBrowser(name, path) {
  const result = { name, steps: [], errors: [] };
  report.browsers.push(result);
  const profile = resolve(directory, name);
  const child = spawn(path, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    ...(extensionProbe ? ["--enable-unsafe-extension-debugging", `--load-extension=${extension}`, `--disable-extensions-except=${extension}`] : []),
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox", "about:blank"],
    { windowsHide: true, stdio: "ignore" });
  child.on("error", error => result.errors.push(error.message));
  let browser;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const browserPort = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
        const version = await cdpJson(browserPort, "/json/version");
        browser = new CdpClient(version.webSocketDebuggerUrl);
        result.version = version.Browser;
        break;
      } catch { await sleep(100); }
    }
    if (!browser) throw new Error("Owned browser CDP not available");
    let control;
    if (extensionProbe) {
      const { id } = await browser.send("Extensions.loadUnpacked", { path: extension });
      const { targetId } = await browser.send("Target.createTarget", { url: `chrome-extension://${id}/options.html` });
      const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
      control = async expression => {
        const answer = await browser.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, transportProbe ? 25000 : 5000, sessionId);
        if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description || answer.exceptionDetails.text);
        return answer.result.value;
      };
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await control("Boolean(globalThis.chrome?.debugger)")) break;
        await sleep(50);
      }
    }
    const targets = await Promise.all(["127.0.0.1", "localhost"].map(async (host, index) => {
      const url = `http://${host}:${port}/${name}/${resultFrames?(index?'fill':'single'):index}`;
      let targetId, send;
      if (extensionProbe) {
        const tab = await control(`chrome.tabs.create({url:${JSON.stringify(url)},active:false})`);
        targetId = tab.id;
        if (!transportProbe) await control(`chrome.debugger.attach({tabId:${tab.id}},"1.3")`);
        send = (method, params = {}) => control(`chrome.debugger.sendCommand({tabId:${tab.id}},${JSON.stringify(method)},${JSON.stringify(params)})`);
      } else {
        ({ targetId } = await browser.send("Target.createTarget", { url, background: true }));
        const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
        send = (method, params = {}) => browser.send(method, params, 5000, sessionId);
      }
      const evaluate = transportProbe
        ? expression => control(`chrome.scripting.executeScript({target:{tabId:${targetId}},world:"MAIN",func:()=>(${expression})}).then(r=>r[0].result)`)
        : async expression => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await evaluate("Boolean(window.canvasState)")) break;
        await sleep(50);
      }
      if (index && !transportProbe) await send("Page.enable");
      return { targetId, send, evaluate, index, url };
    }));
    await Promise.all(targets.map(async target => {
      let previous;
      const screenshot = async label => {
        const step = { site: target.url, page_enabled: Boolean(target.index), label, started_at: Date.now() };
        result.steps.push(step);
        try {
          if (cycleFocus && !transportProbe) await target.send("Emulation.setFocusEmulationEnabled", { enabled: true });
          let shot;
          if (transportProbe) {
            const answer = await control(`chrome.runtime.sendMessage({type:"PROBE_TRANSPORT",tabId:${target.targetId},operation:"capture"})`);
            if (!answer.ok) throw new Error(answer.error);
            shot=answer.result;
            step.frame=shot.frame;
          } else shot = await target.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          step.elapsed_ms = Date.now() - step.started_at;
          step.changed = previous ? previous !== shot.data : null;
          previous = shot.data;
          step.file = resolve(directory, `${name}-${target.index}-${label}.png`);
          await writeFile(step.file, Buffer.from(shot.data, "base64"));
          step.website = await target.evaluate("({visibility:document.visibilityState,selected:canvasState.selected,events:canvasState.events})");
        } catch (error) { step.error = error.message; }
        finally { if (cycleFocus && !transportProbe) await target.send("Emulation.setFocusEmulationEnabled", { enabled: false }); }
        console.log(name, target.index, label, step.error || `${step.elapsed_ms}ms`);
      };
      await screenshot("initial");
      if (!transportProbe) await target.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      const click = async (x, timestamp, y=78) => {
        if (transportProbe) {
          const answer=await control(`chrome.runtime.sendMessage({type:"PROBE_TRANSPORT",tabId:${target.targetId},operation:"click",point:{x:${x},y:${y}}})`);
          if (!answer.ok) throw new Error(answer.error);
          return;
        }
        if (cycleFocus) await target.send("Emulation.setFocusEmulationEnabled", { enabled: true });
        for (const type of ["mousePressed", "mouseReleased"]) await target.send("Input.dispatchMouseEvent", {
          type, button: "left", clickCount: 1, x, y, timestamp,
        });
        if (cycleFocus) await target.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      };
      if(resultFrames){
        await click(68,Date.now()/1000);
        await screenshot('selected');
        if(target.index){
          if(!transportProbe)throw new Error('Result-frame fill probe requires actual product transport');
          const answer=await control(`chrome.runtime.sendMessage({type:"PROBE_TRANSPORT",tabId:${target.targetId},operation:"text",value:"Alpha"})`);
          if(!answer.ok)throw new Error(answer.error);
        }
        await screenshot('answered');
        await click(88,Date.now()/1000,148);
        await screenshot('final');
        const bitmap=await target.evaluate("document.querySelector('canvas').toDataURL('image/png')");
        const file=resolve(directory,`${name}-${target.index}-backing-bitmap.png`);
        await writeFile(file,Buffer.from(bitmap.split(',')[1],'base64'));
        result.backing_bitmaps??=[];result.backing_bitmaps.push({site:target.url,file,canvas_pixels_modified:false});
        return;
      }
      await click(68, (Date.now() + 10000) / 1000);
      await screenshot("future-input");
      await click(198, Date.now() / 1000);
      await screenshot("current-input");
      await target.send("Page.setWebLifecycleState", { state: "active" });
      await screenshot("lifecycle-active");
      if (!transportProbe) await target.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    }));
  } catch (error) { result.errors.push(error.message); }
  finally {
    if (browser) { try { await browser.send("Browser.close", {}, 5000); } catch {} browser.close(); }
    else if (child.exitCode === null) child.kill();
  }
}

console.log("REPORT_DIRECTORY", directory);
try {
  await Promise.all([
    runBrowser("chrome", resolve(root, ".browser-regression-runtime/chrome-cft/chrome-win64/chrome.exe")),
    runBrowser("edge", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
  ]);
} finally {
  server.close();
  report.finished_at = new Date().toISOString();
  report.passed = report.browsers.length === 2 && report.browsers.every(browser =>
    browser.errors.length === 0 && browser.steps.length === 8 && browser.steps.every(step => !step.error));
  if (!report.passed) process.exitCode = 1;
  await writeFile(resolve(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log("FINAL", JSON.stringify(report));
}
