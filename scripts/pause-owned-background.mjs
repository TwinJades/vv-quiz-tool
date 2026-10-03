import {readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {CdpClient,cdpJson} from './cdp-client.mjs';
import {readTestVisualReadings} from './record-test-visual-readings.mjs';
const root=resolve(import.meta.dirname,'..','.browser-regression-runtime');
const directory=resolve(process.argv[2]??'');
if(!relative(root,directory).startsWith('background-'))throw new Error('Only an owned background test may be paused');
const report=JSON.parse(await readFile(resolve(directory,'report.json'),'utf8'));
const stopAll=process.argv.includes('--stop-all');
const site=report.results.find(site=>site.id===process.argv[3]&&site.public_canvas===true);
if(!stopAll&&!site?.tab_id)throw new Error('Owned public Canvas session not found');
const target=(await cdpJson(report.cdp_port,'/json/list')).find(target=>target.url===`chrome-extension://${report.extension_id}/options.html`);
if(!target)throw new Error('Owned test control is not live');
const control=new CdpClient(target.webSocketDebuggerUrl);
try{
  if(stopAll){
    for(const item of report.results.filter(item=>Number.isInteger(item.tab_id))) {
      const result=await control.evaluate(`chrome.runtime.sendMessage({type:'VV_STOP_SESSION',tab_id:${item.tab_id}})`);
      console.log('OWNED_SESSION_STOP',item.id,Boolean(result?.ok));
    }
  } else if(process.argv.includes('--models')) {
    console.log('AUTHORIZED_MODELS',JSON.stringify(await control.evaluate(`(async()=>{const data=await chrome.storage.local.get(null);const p=data[${JSON.stringify('provider-profile:'+report.provider_id)}];const base=p.base_url.endsWith('/')?p.base_url.slice(0,-1):p.base_url;const r=await fetch(base+'/models',{headers:{Authorization:'Bearer '+data['provider-secret:'+p.secret_ref]}});if(!r.ok)throw new Error('Catalog HTTP '+r.status);const listed=(await r.json()).data.map(item=>item.id);return listed.filter(id=>['gemini-3.8-flash','gemini-3.7-flash','gemini-3.1-pro'].some(prefix=>id===prefix||id.startsWith(prefix+'-'))).map(id=>({id,configured:p.model_catalog.models.includes(id)}));})()`)));
  } else {
  console.log('GEOMETRY',JSON.stringify(await control.evaluate(`chrome.tabs.sendMessage(${site.tab_id},{type:'VV_VISUAL_GEOMETRY'},{frameId:0})`)));
  console.log('ROOTS',JSON.stringify(await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${site.tab_id}},world:'MAIN',func:()=>[...document.querySelectorAll("[data-vv-question],[data-question],[data-question-id],.h5p-question,.quiz-question,.question-card,fieldset,[role='radiogroup']")].filter(root=>root.getBoundingClientRect().width>0&&root.getBoundingClientRect().height>0&&root.querySelector('input,textarea,select')).map(root=>({tag:root.tagName,class:root.className,role:root.getAttribute('role'),text:root.innerText.slice(0,180)}))})`)));
  if(process.argv.includes('--inspect')) {
    console.log('READINGS',JSON.stringify(await control.evaluate(readTestVisualReadings)));
    console.log('SESSION',JSON.stringify(await control.evaluate(`chrome.runtime.sendMessage({type:'VV_GET_SESSION',tab_id:${site.tab_id}})`)));
  } else console.log(JSON.stringify(await control.evaluate(`chrome.runtime.sendMessage({type:'VV_PAUSE_SESSION',tab_id:${site.tab_id}})`)));
  }
}
finally{control.close();}
