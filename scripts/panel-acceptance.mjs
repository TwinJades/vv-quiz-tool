// Native UI input only, against an owned headless extension panel and local HTTP
// activities. Never controls a user tab/window; all Provider replies are local.
export async function runPanelCases({name,port,profiles,control,cdp,extensionId,result,directory,writeFile,resolve,heldLife,lifeCounts}) {
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const item=result.panel_actions={passed:false,error:null,checks:[],native_input:true,external_model_calls:0};
  let panelTarget,panel;
  const ownedSessions=[];
  const send=async request=>{const r=await control.evaluate(`chrome.runtime.sendMessage(${JSON.stringify(request)})`);if(!r.ok)throw new Error(r.error);return r.result;};
  const state=tabId=>send({type:'VV_GET_SESSION',tab_id:tabId});
  const waitFor=async(check,label)=>{for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw new Error(`Panel observation deadline: ${label}`);};
  const release=id=>{const key=`${name}:${id}`;heldLife.get(key)?.();heldLife.delete(key);};
  const button=async(url,label)=>{
    const point=await panel.evaluate(`(()=>{const card=${url?`[...document.querySelectorAll('article.task')].find(card=>[...card.querySelectorAll('p.muted')].some(p=>p.textContent===${JSON.stringify(url)}))`:'document'};const button=[...card?.querySelectorAll('button')??[]].find(button=>button.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw new Error('Panel button unavailable');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();if(r.width<=0||r.height<=0||r.top<0||r.bottom>innerHeight)throw new Error('Panel button outside viewport');return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await panel.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    try {
      await panel.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await panel.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    }finally{await panel.send('Emulation.setFocusEmulationEnabled',{enabled:false});}
  };
  const setConcurrency=async limit=>{
    const point=await panel.evaluate("(()=>{const input=document.querySelector('#concurrency');input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await panel.send('Emulation.setFocusEmulationEnabled',{enabled:true});
    try{
      await panel.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await panel.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      await panel.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await panel.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await panel.send('Input.insertText',{text:String(limit)});
    }finally{await panel.send('Emulation.setFocusEmulationEnabled',{enabled:false});}
    await button(null,'应用');
    await waitFor(async()=> (await send({type:'VV_GET_TASKS'})).concurrency===limit,'concurrency UI');
  };
  const start=async(id,host,strategy)=>{
    const p={...profiles.find(p=>p.provider_type==='openai_compatible'),provider_profile_id:`life-${id}`,secret_ref:`life-${id}`,
      base_url:`http://127.0.0.1:${port}/${name}/openai_compatible/life-${id}/v1`};
    await control.evaluate(`chrome.storage.local.set(${JSON.stringify({[`provider-profile:${p.provider_profile_id}`]:p,[`provider-secret:${p.secret_ref}`]:'local-fixture-only'})})`);
    const url=`http://${host}:${port}/life/${name}/${id}`;
    const tab=await control.evaluate(`chrome.tabs.create({url:${JSON.stringify(url)},active:false})`);await pause(250);
    await send({type:'VV_START_SESSION',tab_id:tab.id,provider_profile_id:p.provider_profile_id,model_id:p.model_catalog.models[0],strategy,model_call_limit:5,observation_input_mode:'structured'});
    const session={id,url,tab};ownedSessions.push(session);return session;
  };
  try{
    panelTarget=(await cdp.send('Target.createTarget',{url:`chrome-extension://${extensionId}/tasks.html`})).targetId;
    panel=await cdp.attach(panelTarget);
    await panel.send('Emulation.setDeviceMetricsOverride',{width:1000,height:1600,deviceScaleFactor:1,mobile:false});
    await waitFor(()=>panel.evaluate("Boolean(document.querySelector('#apply'))"),'panel loaded');
    await panel.evaluate("window.__vvPanelClicks=[];document.addEventListener('click',event=>{if(event.target.closest('button'))window.__vvPanelClicks.push({label:event.target.closest('button').textContent,trusted:event.isTrusted})});true");
    await setConcurrency(1);
    const a=await start('panel-a','localhost','unattended'),b=await start('panel-b','127.0.0.1','unattended');
    await waitFor(async()=>heldLife.has(`${name}:${a.id}`)&&(await state(b.tab.id)).state==='QUEUED','one running / one queued');
    await waitFor(()=>panel.evaluate("document.querySelectorAll('article.task').length===2"),'two cards');
    await button(b.url,'暂停');await waitFor(async()=> (await state(b.tab.id)).state==='PAUSED','pause queued');
    if(lifeCounts.has(`${name}:${b.id}`))throw new Error('Queued pause sent a Provider request');
    await pause(1100);await button(b.url,'继续');await waitFor(async()=> (await state(b.tab.id)).state==='QUEUED','resume queued');
    item.checks.push('queued_pause_resume/no_queued_request');
    await setConcurrency(2);await waitFor(()=>heldLife.has(`${name}:${b.id}`),'raise limit starts queue');
    await setConcurrency(1);
    if((await send({type:'VV_GET_TASKS'})).running.length!==2)throw new Error('Lowering concurrency preempted a live task');
    await setConcurrency(2);item.checks.push('native_concurrency_change/nonpreemptive_decrease');
    await button(a.url,'暂停');await waitFor(async()=> (await state(a.tab.id)).state==='PAUSED','pause active');release(a.id);await pause(200);
    const [page]=await control.evaluate(`chrome.scripting.executeScript({target:{tabId:${a.tab.id}},func:()=>document.querySelector('input[value=a]').checked})`);
    if(page.result!==false)throw new Error('Late paused response applied');
    await pause(1100);await button(a.url,'继续');await waitFor(async()=> (await state(a.tab.id)).state==='COMPLETE','resume complete');
    await pause(1100);
    await button(b.url,'回到网站');
    if(!await control.evaluate(`chrome.tabs.get(${b.tab.id}).then(tab=>tab.active)`))throw new Error('Jump did not activate target owned tab');
    item.checks.push('active_pause/late_isolation/resume/jump_to_owned_tab');
    await button(b.url,'停止');await waitFor(async()=> (await state(b.tab.id)).state==='CANCELLED','stop');release(b.id);await pause(1100);
    const screenshot=await panel.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    item.screenshot=resolve(directory,`${name}-panel-actions.png`);await writeFile(item.screenshot,Buffer.from(screenshot.data,'base64'));
    item.completed=await state(a.tab.id);item.cancelled=await state(b.tab.id);
    await button(b.url,'清除本场');await waitFor(async()=>!(await state(b.tab.id)),'clear cancelled');
    await pause(1100);await button(a.url,'清除本场');await waitFor(async()=>!(await state(a.tab.id)),'clear completed');
    await waitFor(()=>panel.evaluate("document.querySelectorAll('article.task').length===0"),'empty UI');
    item.storage_cleared=await control.evaluate(`chrome.storage.session.get(${JSON.stringify([`vv-session-snapshot:${a.tab.id}`,`vv-session-snapshot:${b.tab.id}`])}).then(data=>Object.keys(data).length===0)`);
    item.clicks=await panel.evaluate('window.__vvPanelClicks');item.ui_error=await panel.evaluate("document.querySelector('#error').textContent");
    if(!item.storage_cleared||item.ui_error||item.clicks.length<15||item.clicks.some(click=>!click.trusted))throw new Error('UI state, storage or native input gate failed');
    item.checks.push('native_stop/clear_summary/empty_panel/trusted_clicks');
    await setConcurrency(3);item.passed=true;
  }catch(error){item.error=error.message;}
  finally{
    for(const session of ownedSessions){
      const snapshot=await state(session.tab.id).catch(()=>null);
      if(snapshot){await send({type:'VV_STOP_SESSION',tab_id:session.tab.id}).catch(()=>{});release(session.id);await send({type:'VV_CLEAR_SESSION',tab_id:session.tab.id}).catch(()=>{});}
    }
    await send({type:'VV_SET_CONCURRENCY',limit:3}).catch(()=>{});
    if(panelTarget)await cdp.send('Target.closeTarget',{targetId:panelTarget}).catch(()=>{});
  }
}
