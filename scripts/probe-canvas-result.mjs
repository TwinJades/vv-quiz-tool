// Compare actual canvas backing pixels and composited screenshots after trusted
// native input. No pixel editing, model, user profile or desktop focus changes.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CdpClient,cdpJson} from './cdp-client.mjs';
import {canvasFixtureHtml} from './canvas-fixture.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,'.browser-regression-runtime',`canvas-result-probe-${new Date().toISOString().replaceAll(':','-')}`);
await mkdir(directory,{recursive:true});
const report={directory,headless:true,parallel:true,external_model_calls:0,canvas_pixels_modified:false,browsers:[]};
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(canvasFixtureHtml(req.url.endsWith('fill')?'fill':'single'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(name,path){
  const result={name,sites:[],errors:[]};report.browsers.push(result);
  const profile=resolve(directory,name);const child=spawn(path,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-gpu','--no-sandbox','about:blank'],{windowsHide:true,stdio:'ignore'});let browser;
  try{
    for(let i=0;i<100;i++){try{const debug=Number((await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);browser=new CdpClient((await cdpJson(debug,'/json/version')).webSocketDebuggerUrl);break;}catch{await pause(100);}}
    if(!browser)throw new Error('Owned browser unavailable');
    await Promise.all(['single','fill'].map(async(kind,index)=>{
      const item={kind,errors:[]};result.sites.push(item);
      const {targetId}=await browser.send('Target.createTarget',{url:`http://${index?'localhost':'127.0.0.1'}:${port}/${kind}`,background:true});const page=await browser.attach(targetId);
      try{
        for(let i=0;i<50;i++){if(await page.evaluate('Boolean(window.canvasState)'))break;await pause(100);}
        const click=async(x,y)=>{await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});try{await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x,y});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x,y});}finally{await page.send('Emulation.setFocusEmulationEnabled',{enabled:false});}};
        await click(68,78);
        if(kind==='fill'){
          await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
          try{
            for(const params of [{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2},{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2},{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8},{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8}])await page.send('Input.dispatchKeyEvent',params);
            for(const char of 'Alpha')for(const type of ['keyDown','keyUp'])await page.send('Input.dispatchKeyEvent',{type,key:char,...(type==='keyDown'?{text:char}:{})});
          }finally{await page.send('Emulation.setFocusEmulationEnabled',{enabled:false});}
        }
        await click(88,148);await pause(1000);
        const bitmap=await page.evaluate(`(()=>{const c=document.querySelector('canvas'),ctx=c.getContext('2d');return {data:c.toDataURL('image/png'),state:canvasState,context:{composite:ctx.globalCompositeOperation,align:ctx.textAlign,transform:ctx.getTransform().toJSON()},visibility:document.visibilityState};})()`);
        item.state=bitmap.state;item.context=bitmap.context;item.visibility=bitmap.visibility;
        item.backing_bitmap=resolve(directory,`${name}-${kind}-bitmap.png`);await writeFile(item.backing_bitmap,Buffer.from(bitmap.data.split(',')[1],'base64'));
        await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
        const ack=e=>{const m=JSON.parse(e.data);if(m.sessionId===page.sessionId&&m.method==='Page.screencastFrame')void page.send('Page.screencastFrameAck',{sessionId:m.params.sessionId}).catch(()=>{});};browser.socket.addEventListener('message',ack);
        try{await page.send('Page.startScreencast',{format:'png'});await pause(1000);const shot=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});item.screenshot=resolve(directory,`${name}-${kind}-screenshot.png`);await writeFile(item.screenshot,Buffer.from(shot.data,'base64'));}
        finally{await page.send('Page.stopScreencast').catch(()=>{});browser.socket.removeEventListener('message',ack);await page.send('Emulation.setFocusEmulationEnabled',{enabled:false});}
      }catch(e){item.errors.push(e.message);}finally{await browser.send('Target.closeTarget',{targetId}).catch(()=>{});}
      console.log('CANVAS',JSON.stringify({name,kind,completed:item.state?.completed,errors:item.errors}));
    }));
  }catch(e){result.errors.push(e.message);}finally{if(browser){try{await browser.send('Browser.close');}catch{}browser.close();}else if(child.exitCode===null)child.kill();}
}
console.log('REPORT_DIRECTORY',directory);
try{await Promise.all([run('chrome',resolve(root,'.browser-regression-runtime/chrome-cft/chrome-win64/chrome.exe')),run('edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')]);}
finally{server.close();report.finished_at=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));if(report.browsers.some(b=>b.errors.length||b.sites.some(s=>s.errors.length||!s.state?.completed)))process.exitCode=1;}
