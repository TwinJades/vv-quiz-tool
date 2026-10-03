import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {transform} from 'esbuild';
import {CdpClient,cdpJson} from './cdp-client.mjs';
import {preparePublicCanvas} from './prepare-public-canvas.mjs';
const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,'.browser-regression-runtime',`canvas-surface-probe-${new Date().toISOString().replaceAll(':','-')}`);
await mkdir(directory,{recursive:true});
const report={directory,headless:true,parallel:true,external_model_calls:0,results:[],errors:[]};
const code=(await transform(await readFile(resolve(root,'src/web/visual-geometry.ts'),'utf8'),{loader:'ts',format:'iife',globalName:'VVGeometryProbe'})).code;
const child=spawn(resolve(root,'.browser-regression-runtime/chrome-cft/chrome-win64/chrome.exe'),['--headless=new','--remote-debugging-port=0',`--user-data-dir=${resolve(directory,'profile')}`,'--no-first-run','--no-default-browser-check','--disable-gpu','--no-sandbox','about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let browser;
try{
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(resolve(directory,'profile/DevToolsActivePort'),'utf8')).split('\n')[0]);const version=await cdpJson(port,'/json/version');browser=new CdpClient(version.webSocketDebuggerUrl);break;}catch{await pause(100)}}
  if(!browser)throw new Error('Owned probe browser did not start');
  console.log('REPORT_DIRECTORY',directory);
  await Promise.all([
    {id:'wordwall-science',url:'https://wordwall.net/resource/114600206/general-science-quiz'},
    {id:'wordwall-cells',url:'https://wordwall.net/resource/50307/science/science-quiz'},
  ].map(async site=>{
    const item={...site,error:null};report.results.push(item);let page;
    try{
      const {targetId}=await browser.send('Target.createTarget',{url:site.url,background:true});
      const prepared=await preparePublicCanvas(site,port,directory);
      item.bootstrap=prepared.evidence;page=prepared.page;
      item.geometry=await page.evaluate(`(()=>{${code};return VVGeometryProbe.captureVisualGeometry(document,null)})()`);
      item.roots=await page.evaluate(`(()=>{const visible=e=>{const style=getComputedStyle(e),rect=e.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;};return [...document.querySelectorAll("[data-vv-question],[data-question],[data-question-id],.h5p-question,.quiz-question,.question-card,fieldset,[role='radiogroup']")].filter(visible).map(root=>({tag:root.tagName,class:root.className,role:root.getAttribute('role'),text:root.innerText.slice(0,200),inputs:[...root.querySelectorAll('input,textarea,select')].map(input=>({type:input.type,name:input.name,visible:visible(input)}))}));})()`);
    }catch(error){item.error=error.message;}
    finally{page?.close();}
    console.log('SURFACE',JSON.stringify(item));
  }));
}catch(error){report.errors.push(error.message);process.exitCode=1;}
finally{if(browser){try{await browser.send('Browser.close')}catch{}browser.close();}else child.kill();report.finished_at=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));}
