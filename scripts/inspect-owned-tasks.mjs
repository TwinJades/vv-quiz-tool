import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { CdpClient, cdpJson } from './cdp-client.mjs';
const root = resolve(import.meta.dirname, '..', '.browser-regression-runtime');
const directory = resolve(process.argv[2] ?? '');
if (!relative(root, directory).startsWith('provider-mv3-')) throw new Error('Only an owned provider fixture profile can be inspected');
const port = Number((await readFile(resolve(directory, 'edge/DevToolsActivePort'), 'utf8')).split('\n')[0]);
const version = await cdpJson(port, '/json/version');
const cdp = new CdpClient(version.webSocketDebuggerUrl);
try {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const control = targetInfos.find(target => target.url.startsWith('chrome-extension://') && target.url.endsWith('/options.html'));
  if (!control) throw new Error('Owned fixture control not live');
  const target = await cdp.attach(control.targetId);
  console.log(JSON.stringify(await target.evaluate(`chrome.runtime.sendMessage({type:'VV_GET_TASKS'}).then(response=>response.result?.tasks.map(task=>({tab_id:task.tab_id,state:task.snapshot.state,calls:task.snapshot.model_calls,progress:task.snapshot.progress,notice:task.snapshot.notice})))`), null, 2));
  for (const page of targetInfos.filter(target => /\/budget\//.test(target.url))) {
    const attached = await cdp.attach(page.targetId);
    console.log(JSON.stringify({ url: page.url, page: await attached.evaluate('({answers:window.answers,checks:window.checks,current:window.current,completed:window.completed,selected:document.querySelector("input[value=a]")?.checked,text:document.body.innerText.slice(0,220)})') }));
  }
} finally { cdp.close(); }
