import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CdpClient, cdpJson } from './cdp-client.mjs';
import { screenshotPixels, wordwallStartPoint } from './png-pixels.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const geometry=`(()=>{const canvases=[...document.querySelectorAll('canvas')].map(canvas=>canvas.getBoundingClientRect()).filter(rect=>rect.width>400&&rect.height>250&&rect.x>=0&&rect.y>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight);return canvases.length===1?{x:canvases[0].x,y:canvases[0].y,width:canvases[0].width,height:canvases[0].height}:null;})()`;
export async function preparePublicCanvas(site,port,directory) {
  if(!/^https:\/\/wordwall\.net\/resource\/(?:114600206|50307)\//.test(site.url))throw new Error('Unknown public Canvas bootstrap');
  let target;
  for(let i=0;i<100;i++){target=(await cdpJson(port,'/json/list')).find(target=>target.type==='page'&&target.url===site.url);if(target)break;await pause(100);}
  if(!target)throw new Error('Owned public Canvas tab did not navigate');
  const page=new CdpClient(target.webSocketDebuggerUrl);
  let prepared=false;
  try {
    await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    const deadline=Date.now()+90000;
    while(Date.now()<deadline){
      const rect=await page.evaluate(geometry);
      if(!rect){await pause(1000);continue;}
      await page.send('Page.startScreencast',{format:'png',maxFramesInFlight:1});
      let png;
      try{png=Buffer.from((await page.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');}
      finally{await page.send('Page.stopScreencast').catch(()=>{});}
      const point=wordwallStartPoint(screenshotPixels(png),rect);
      if(!point){await pause(1000);continue;}
      const before=resolve(directory,`${site.id}-before-start.png`);
      await writeFile(before,png);
      const current=await page.evaluate(geometry);
      if(JSON.stringify(current)!==JSON.stringify(rect))throw new Error('Public game geometry changed before START');
      // Only the reviewed blue START overlay, before VV owns this session.
      await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      await pause(1500);
      await page.send('Page.startScreencast',{format:'png',maxFramesInFlight:1});
      try{
        const afterPng=Buffer.from((await page.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data,'base64');
        await writeFile(resolve(directory,`${site.id}-after-start.png`),afterPng);
        const afterRect=await page.evaluate(geometry);
        if(!afterRect||wordwallStartPoint(screenshotPixels(afterPng),afterRect))throw new Error('Public game START overlay did not disappear');
      }finally{await page.send('Page.stopScreencast').catch(()=>{});}
      await page.send('Emulation.setFocusEmulationEnabled',{enabled:false});
      prepared=true;
      return {page,evidence:{width:1280,height:900,start_point:point,before_screenshot:before,started_from_visible_overlay:true,desktop_focus_changed:false,viewport_connection_retained:true}};
    }
    throw new Error('Public game did not show the reviewed START overlay');
  }finally{if(!prepared)page.close();}
}
