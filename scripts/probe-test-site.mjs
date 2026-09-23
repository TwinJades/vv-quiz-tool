const base = `http://127.0.0.1:${process.argv[2] ?? 9341}`;
const urls = process.argv.slice(3);
const begin = urls.includes("--begin");
if (begin) urls.splice(urls.indexOf("--begin"), 1);
if (urls.length === 0) throw new Error("Provide one or more URLs.");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function inspect(url) {
  const response = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not open ${url}: HTTP ${response.status}`);
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const current = pending.get(message.id);
    if (!current) return;
    pending.delete(message.id);
    message.error ? current.reject(new Error(message.error.message)) : current.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const nextId = ++id;
    pending.set(nextId, { resolve, reject });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
  await send("Runtime.enable");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(1_000);
    const ready = await send("Runtime.evaluate", { expression: "location.href !== 'about:blank' && (document.body?.innerText?.length ?? 0) > 250", returnByValue: true });
    if (ready.result.value) break;
  }
  await sleep(1_000);
  if (begin) {
    await send("Runtime.evaluate", { expression: `([...document.querySelectorAll('button,a')].find(e=>/Begin Assessment/i.test(e.textContent??''))?.click(),true)`, returnByValue: true });
    await sleep(1_000);
  }
  const expression = `({
    url: location.href,
    title: document.title,
    text: document.body?.innerText?.slice(0,1200) ?? '',
    inputs: [...document.querySelectorAll('input,textarea,[contenteditable=true]')].slice(0,20).map(e=>({tag:e.tagName,type:e.type??null,name:e.name??null,placeholder:e.placeholder??null})),
    choices: [...document.querySelectorAll('[role=checkbox],[role=radio],.h5p-alternative')].slice(0,12).map(e=>({tag:e.tagName,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),className:e.className,text:e.textContent?.trim().slice(0,80),images:[...e.querySelectorAll('img')].map(i=>i.alt)})),
    controls: [...document.querySelectorAll('button,[role=button]')].slice(0,20).map(e=>e.textContent?.trim().slice(0,80)),
    images: [...document.querySelectorAll('img')].slice(0,12).map(e=>({alt:e.alt,src:e.currentSrc||e.src})),
    frames: [...document.querySelectorAll('iframe')].map(e=>({src:e.src,title:e.title,html:e.outerHTML.slice(0,500),text:e.contentDocument?.body?.innerText?.slice(0,800)??null,inputs:[...(e.contentDocument?.querySelectorAll('input,textarea')??[])].slice(0,10).map(a=>({tag:a.tagName,type:a.type??null}))})),
  })`;
  const result = await send("Runtime.evaluate", { expression, returnByValue: true });
  socket.close();
  await fetch(`${base}/json/close/${target.id}`);
  return result.result.value;
}

for (const url of urls) {
  try { console.log(JSON.stringify(await inspect(url))); }
  catch (error) { console.log(JSON.stringify({ url, error: String(error) })); }
}
