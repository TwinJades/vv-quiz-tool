// Narrow regression probe for the publicly visible wrong-answer/retry state.
// No provider, user browser, library state, solutions or hidden answer data.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { CdpClient, cdpJson } from './cdp-client.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=resolve(root,'.browser-regression-runtime',`h5p-grading-probe-${new Date().toISOString().replaceAll(':','-')}`);
await mkdir(directory,{recursive:true});
const bundle=await build({stdin:{contents:'export { DomWebAdapter } from "./src/web/dom-adapter";',resolveDir:root,loader:'ts'},bundle:true,format:'iife',globalName:'VVProbe',write:false});
const report={directory,url:'https://h5pstudio.ecampusontario.ca/content/2360',headless:true,external_model_calls:0,solutions_opened:false,errors:[]};
const trueFalse=process.argv.includes('--true-false');report.mode=trueFalse?'first_true_false':'second_fill';
const wrongTrueFalse=process.argv.includes('--wrong');
const correctFill=process.argv.includes('--correct');
const retryCorrect=process.argv.includes('--retry-correct');
const lastQuestion=process.argv.includes('--last-question');
const finishFlow=process.argv.includes('--finish-flow');
const child=spawn(resolve(root,'.browser-regression-runtime/chrome-cft/chrome-win64/chrome.exe'),['--headless=new','--remote-debugging-port=0',`--user-data-dir=${resolve(directory,'profile')}`,'--no-first-run','--no-default-browser-check','--disable-gpu','--no-sandbox','about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
const visible=`const visible=e=>{for(let p=e;p;p=p.parentElement){const s=e.ownerDocument.defaultView.getComputedStyle(p);if(p.hidden||p.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden')return false;}return true;};`;
async function click(selector,index=0,delay=350){
  const point=await page.evaluate(`(()=>{${visible}const e=[...probeDocument.querySelectorAll(${JSON.stringify(selector)})].filter(visible)[${index}];if(!e)throw new Error('Visible control missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();let x=r.x+r.width/2,y=r.y+r.height/2,w=e.ownerDocument.defaultView;while(w.frameElement){const f=w.frameElement;f.scrollIntoView({block:'center'});const b=f.getBoundingClientRect();x+=b.x+f.clientLeft;y+=b.y+f.clientTop;w=f.ownerDocument.defaultView;}return {x,y};})()`);
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  await pause(delay);
}
async function state(){return page.evaluate(`(async()=>{${visible}const q=[...probeDocument.querySelectorAll('.h5p-question')].find(visible);return {state:await probeAdapter.readState(new AbortController().signal),visible_grading:[...q.querySelectorAll('[class*=feedback],[class*=score],[class*=wrong],[class*=correct]')].filter(visible).map(e=>({tag:e.tagName,class:e.className,label:e.getAttribute('aria-label'),text:e.innerText})),inputs:[...q.querySelectorAll('input')].filter(visible).map(e=>({class:e.className,disabled:e.disabled,readonly:e.readOnly,value:e.value,label:e.getAttribute('aria-label')}))};})()`);}
try{
  console.log('REPORT_DIRECTORY',directory);
  for(let i=0;i<100;i++){try{const port=Number((await readFile(resolve(directory,'profile/DevToolsActivePort'),'utf8')).split('\n')[0]);browser=new CdpClient((await cdpJson(port,'/json/version')).webSocketDebuggerUrl);break;}catch{await pause(100);}}
  if(!browser)throw new Error('Owned browser did not start');
  const {targetId}=await browser.send('Target.createTarget',{url:report.url,background:true});page=await browser.attach(targetId);
  await page.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await page.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  let ready=false;
  for(let i=0;i<100;i++){ready=await page.evaluate(`(()=>{const docs=[document];for(let i=0;i<docs.length;i++)for(const f of docs[i].querySelectorAll('iframe')){try{if(f.contentDocument&&!docs.includes(f.contentDocument))docs.push(f.contentDocument);}catch{}}window.probeDocument=docs.find(d=>d.querySelectorAll('.questionset .progress-dot').length===8);return Boolean(probeDocument);})()`);if(ready)break;await pause(300);}
  if(!ready)throw new Error('Public eight-question activity not ready');
  if(finishFlow){
    report.earlier_native_checks=0;
    for(let number=1;number<8;number++){
      await click('.questionset .progress-dot[aria-label^="Question '+number+' of 8"]');
      const kind=await page.evaluate(`(()=>{${visible}const q=[...probeDocument.querySelectorAll('.h5p-question')].find(visible);return q.querySelector('input[type=text]')?'fill':q.querySelector('.h5p-answer')?'multi':'tf';})()`);
      if(kind==='fill'){await click('.h5p-question input[type=text]');await page.send('Input.insertText',{text:'3'});}
      else await click(kind==='multi'?'.h5p-question .h5p-answer':'.h5p-question [role=radio]');
      await click('button.h5p-question-check-answer');report.earlier_native_checks++;
    }
  }
  // Use the actual visible second tab; no earlier answer or quiz config needed.
  await click(lastQuestion?'.questionset .progress-dot[aria-label^="Question 8 of 8"]':trueFalse?'.questionset .progress-dot[aria-label^="Question 1 of 8"]':'.questionset .progress-dot[aria-label^="Question 2 of 8"]');
  await page.evaluate(bundle.outputFiles[0].text+';window.probeAdapter=new VVProbe.DomWebAdapter(probeDocument);');
  report.before=await page.evaluate(`probeAdapter.observeSession('public-grading-probe',new AbortController().signal).then(o=>({total:o.question_total,fingerprint:o.fingerprint,question:o.questions[0].question,locator:o.questions[0].locator_map}))`);
  if(lastQuestion){const index=await page.evaluate(`(()=>{${visible}const answers=[...probeDocument.querySelectorAll('.h5p-question .h5p-answer')].filter(visible);return answers.findIndex(e=>e.innerText.includes('A topic taught in a first-year class in your field'));})()`);if(index<0)throw new Error('Previously observed public model candidate changed');await click('.h5p-question .h5p-answer',index);}
  else if(trueFalse){await click('.h5p-question [role=radio]',wrongTrueFalse?1:0);}
  else{
  if(report.before.question.type!=='fill_blank'||report.before.question.blanks.length!==1)throw new Error('Reviewed second fill question changed');
  await click('.h5p-question input[type=text]');
  // Retained real model candidate from the failed run, deliberately not a solution.
  await page.send('Input.insertText',{text:correctFill?'10':'3'});
  }
  await click('button.h5p-question-check-answer');await pause(1000);
  report.graded=await state();
  if(lastQuestion){
    report.last_dom=await page.evaluate(`(()=>{${visible}const q=[...probeDocument.querySelectorAll('.h5p-question')].find(visible);return {class:q.className,alternatives:[...q.querySelectorAll('.h5p-answer')].map(e=>({class:e.className,role:e.getAttribute('role'),disabled:e.getAttribute('aria-disabled'),visible:visible(e),label:e.querySelector('.h5p-alternative-inner')?.innerText})),controls:[...q.querySelectorAll('button,a,[role=radio],[role=checkbox]')].map(e=>({class:e.className,role:e.getAttribute('role'),visible:visible(e),text:visible(e)?e.innerText:null,label:e.getAttribute('aria-label')}))};})()`);
    const png=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(resolve(directory,'last-grade.png'),Buffer.from(png.data,'base64'));
    report.passed=report.graded.state.feedback==='correct'&&report.graded.state.fingerprint===report.before.fingerprint;
    if(!report.passed)throw new Error('Last graded question lost its feedback or identity');
    if(finishFlow)report.finish_controls=await page.evaluate(`(()=>{${visible}return [...probeDocument.querySelectorAll('button,a,[role=button]')].filter(e=>visible(e)&&/finish|submit/i.test(e.innerText+' '+e.className+' '+e.getAttribute('aria-label'))).map(e=>({tag:e.tagName,class:e.className,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:e.innerText,disabled:e.disabled??null}));})()`);
    if(finishFlow){
      const locator=await page.evaluate(`probeAdapter.observeSession('public-grading-probe',new AbortController().signal).then(o=>o.questions[0].locator_map)`);
      if(!locator.targets.control_submit_session||locator.targets.control_submit)throw new Error('New Finish was not mapped solely as session submission');
      report.finish=await page.evaluate(`probeAdapter.execute(${JSON.stringify({schema_version:locator.schema_version,session_id:'public-grading-probe',question_id:locator.question_id,observation_id:locator.observation_id,strategy:'unattended',actions:[{action_id:'finish',kind:'submit_session',target_id:'control_submit_session'}],preconditions:['same_surface','same_question_fingerprint','target_available']})},${JSON.stringify(locator)},new AbortController().signal)`);
      await pause(1000);report.after_finish=await page.evaluate(`probeAdapter.readState(new AbortController().signal)`);
      report.passed&&=report.finish.every(a=>a.status==='succeeded')&&report.after_finish.completed;
      if(!report.passed)throw new Error('Actual Finish did not reach the results page');
      const final=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(resolve(directory,'final-score.png'),Buffer.from(final.data,'base64'));
    }
  }
  report.graded_choices=await page.evaluate(`(()=>{${visible}const q=[...probeDocument.querySelectorAll('.h5p-question')].find(visible);return [...(q?.querySelectorAll('[role=radio]')??[])].filter(visible).map(e=>({class:e.className,label:e.getAttribute('aria-label'),labelledby:e.getAttribute('aria-labelledby'),disabled:e.getAttribute('aria-disabled'),children:[...e.children].map(c=>({tag:c.tagName,class:c.className,text:c.textContent}))}));})()`);
  if(lastQuestion){console.log('LAST_GRADE',JSON.stringify(report.graded.state));}
  else if((trueFalse&&!wrongTrueFalse)||correctFill){
    report.passed=report.graded.state.feedback==='correct'&&report.graded.state.fingerprint===report.before.fingerprint;
    if(!report.passed)throw new Error('Correct visible grading changed question identity');
    if(correctFill){const observation=await page.evaluate(`probeAdapter.observeSession('public-grading-probe',new AbortController().signal).then(o=>({fingerprint:o.fingerprint,blanks:o.questions[0].question.blanks.length,locator:o.questions[0].locator_map}))`);report.correct_reobservation=observation;if(observation.fingerprint!==report.before.fingerprint||observation.blanks!==1)throw new Error('Correct disabled fill is not the same one-blank question');report.before.locator=observation.locator;}
    const locator=report.before.locator;
    report.advance=await page.evaluate(`probeAdapter.execute(${JSON.stringify({schema_version:locator.schema_version,session_id:'public-grading-probe',question_id:locator.question_id,observation_id:locator.observation_id,strategy:'unattended',actions:[{action_id:'next',kind:'advance',target_id:'control_next'}],preconditions:['same_surface','same_question_fingerprint','target_available']})},${JSON.stringify(locator)},new AbortController().signal)`);
    await pause(350);report.after_advance=await page.evaluate(`probeAdapter.readState(new AbortController().signal)`);
    report.passed&&=report.advance.every(a=>a.status==='succeeded')&&report.after_advance.fingerprint!=='missing'&&report.after_advance.fingerprint!==report.before.fingerprint;
    if(!report.passed)throw new Error('Correct graded question did not actually advance');
    console.log('CORRECT_ADVANCE',JSON.stringify({graded:report.graded.state,advance:report.advance,after:report.after_advance}));
  }
  else{
  report.graded_structure=await page.evaluate(`(()=>{${visible}const q=[...probeDocument.querySelectorAll('.h5p-question')].find(visible);return {paragraphs:[...q.querySelectorAll('h1,h2,h3,p')].filter(visible).map(e=>({class:e.className,text:e.textContent})),grading_wrappers:[...q.querySelectorAll('.h5p-input-wrapper')].map(e=>({text:e.textContent,children:[...e.children].map(c=>({tag:c.tagName,class:c.className,label:c.getAttribute('aria-label'),text:c.tagName==='INPUT'?null:c.textContent}))}))};})()`);
  if(!trueFalse)report.checking_mode_markup=await page.evaluate(`(()=>{const q=[...probeDocument.querySelectorAll('.h5p-question')].find(e=>e.querySelector('input[aria-label*="Answered incorrectly"]'));return [...q.querySelectorAll('*')].filter(e=>e.textContent.trim()==='Checking mode').map(e=>({tag:e.tagName,class:e.className,role:e.getAttribute('role'),live:e.getAttribute('aria-live'),style:e.getAttribute('style')}));})()`);
  report.retry_observation=await page.evaluate(`probeAdapter.observeSession('public-grading-probe',new AbortController().signal).then(o=>({fingerprint:o.fingerprint,question:o.questions[0].question,locator:o.questions[0].locator_map}))`);
  const image=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true});
  await writeFile(resolve(directory,'graded.png'),Buffer.from(image.data,'base64'));
  const retryLocator=report.retry_observation.locator;
  report.retry=await page.evaluate(`probeAdapter.execute(${JSON.stringify({schema_version:retryLocator.schema_version,session_id:'public-grading-probe',question_id:report.retry_observation.question.question_id,observation_id:retryLocator.observation_id,strategy:'unattended',actions:[{action_id:'retry',kind:'retry_question',target_id:'control_retry'}],preconditions:['same_surface','same_question_fingerprint','target_available']})},${JSON.stringify(retryLocator)},new AbortController().signal)`);
  await pause(350);report.after_retry=await state();
  report.passed=report.graded.state.feedback==='incorrect'&&report.graded.state.fingerprint===report.before.fingerprint&&report.retry_observation.fingerprint===report.before.fingerprint&&report.retry.every(a=>a.status==='succeeded')&&report.after_retry.state.feedback===null&&report.after_retry.state.fingerprint===report.before.fingerprint;
  if(!report.passed)throw new Error('Visible grading or same-question retry assertion failed');
  if(retryCorrect&&!trueFalse){
    await page.evaluate(`probeAdapter.observeSession('public-grading-probe',new AbortController().signal)`);
    await click('.h5p-question input[type=text]');
    await page.send('Input.insertText',{text:'10'});
    await click('button.h5p-question-check-answer',0,0);
    report.grading_transition=[];
    for(let i=0;i<60;i++){
      report.grading_transition.push(await page.evaluate(`(async()=>{${visible}const q=[...probeDocument.querySelectorAll('.h5p-question')].find(visible);return {state:await probeAdapter.readState(new AbortController().signal),grading:[...q.querySelectorAll('.h5p-question-feedback,.h5p-question-scorebar,[aria-live],[role=alert]')].map(e=>({class:e.className,visible:visible(e),text:e.innerText,label:e.getAttribute('aria-label'),role:e.getAttribute('role')})),announcements:[...probeDocument.querySelectorAll('[aria-live],[role=alert]')].filter(visible).map(e=>({class:e.className,in_question:q.contains(e),text:e.innerText}))};})()`));
      await pause(50);
    }
    report.passed&&=report.grading_transition.at(-1).state.feedback==='correct';
    if(!report.passed)throw new Error('Retried correct grading did not settle');
  }
  console.log('GRADING',JSON.stringify({before_fingerprint:report.before.fingerprint,graded:report.graded,retry:report.retry,after_retry:report.after_retry}));
  }
}catch(error){report.errors.push(error.message);process.exitCode=1;console.log('PROBE_ERROR',error.message);if(page)try{if(report.graded)report.failed_reobservation=await page.evaluate(`probeAdapter.observeSession('public-grading-probe',new AbortController().signal).then(o=>({fingerprint:o.fingerprint,question:o.questions[0].question}))`);report.failed_page=await page.evaluate('({url:location.href,title:document.title,text:document.body?.innerText?.slice(0,2000)})');const image=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(resolve(directory,'failed.png'),Buffer.from(image.data,'base64'));}catch(diagnostic){report.diagnostic_error=diagnostic.message;}}
finally{if(browser){try{await browser.send('Browser.close');}catch{}browser.close();}else if(child.exitCode===null)child.kill();report.finished_at=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));}
