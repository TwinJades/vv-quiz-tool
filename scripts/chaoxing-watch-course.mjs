import {build} from 'esbuild';
import {appendFile,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CdpClient,cdpJson} from './cdp-client.mjs';
import {ownedExtensionIds,ownedBrowserConnection} from './owned-browser.mjs';

const root=resolve(import.meta.dirname,'..');
const option=process.argv.find(argument=>argument.startsWith('--connection='));
const connectionPath=resolve(root,option?.slice('--connection='.length)??'.browser-regression-runtime/course-login-20261004-040551/connection-login-ready.json');
const connection=await ownedBrowserConnection(connectionPath);
const run=resolve(connection.run_directory);
if(connection.scope!=='owned-isolated-course-materials'||!run.startsWith(resolve(root,'.browser-regression-runtime')+'\\')||
  connection.profile!==resolve(run,'profile'))throw new Error('自有课程资料身份失配。');
const port=connection.port;
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('当前隔离浏览器调试端口无效。');
const stamp=Date.now();
const log=resolve(run,`watch-course-${stamp}.jsonl`),reportPath=resolve(run,`watch-course-${stamp}.json`);
const controller=new AbortController(),signal=controller.signal;
process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
const save=async event=>appendFile(log,JSON.stringify({at:new Date().toISOString(),...event})+'\n');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const targets=await cdpJson(port,'/json/list');
const requested=process.argv.find(argument=>argument.startsWith('--course='))?.slice('--course='.length);
const pages=targets.filter(target=>target.type==='page'&&target.url.startsWith('https://mooc1.chaoxing.com/mycourse/studentstudy')&&(!requested||new URL(target.url).searchParams.get('courseId')===requested));
if(pages.length!==1)throw new Error('需要唯一授权课时页面；多个课程时使用--course指定范围。');
const target=pages[0],url=new URL(target.url),course=url.searchParams.get('courseId'),clazz=url.searchParams.get('clazzid');
if(!course||!clazz)throw new Error('课程或班级公开身份缺失。');
if(!target)throw new Error('请先通过正常课程入口打开授权课时。');
const page=new CdpClient(target.webSocketDebuggerUrl);
const browser=new CdpClient((await cdpJson(port,'/json/version')).webSocketDebuggerUrl);
const bundle=await build({entryPoints:[resolve(root,'src/web/chaoxing-video-page.ts')],bundle:true,write:false,format:'iife',globalName:'VVChaoxingVideo'});
const reader=await build({entryPoints:[resolve(root,'src/web/chaoxing-learning-page.ts')],bundle:true,write:false,format:'iife',globalName:'VVChaoxingReading'});
const report={started_at:new Date().toISOString(),scope:{course_id:course,class_id:clazz},results:[],quizzes:[],hover_events:0,model_requests:0,submissions:0};
const action=expression=>page.evaluate(`(async()=>{const signal=new AbortController().signal;${expression}})()`,90000);
const read=()=>page.evaluate(reader.outputFiles[0].text+';VVChaoxingReading.readChaoxingLearningPage(document)',90000);
async function ready(lesson){
  const until=Date.now()+90000;
  while(Date.now()<until){
    signal.throwIfAborted();
    const tree=await page.send('Page.getFrameTree');
    const url=new URL(tree.frameTree.frame.url);
    if(url.origin!=='https://mooc1.chaoxing.com'||url.searchParams.get('courseId')!==course||url.searchParams.get('clazzid')!==clazz)
      throw new Error('导航后课程、班级或登录页面改变。');
    if(url.searchParams.get('chapterId')===lesson){
      const reading=await read();
      if(reading?.lesson_id===lesson&&reading.videos.every(video=>video.media!==null)&&reading.lesson_title&&
        !reading.diagnostics.some(message=>/课时任务frame|课时目录身份/.test(message)))return reading;
    }
    await sleep(250);
  }
  throw new Error('正常课时导航或播放器加载超时。');
}
async function bind(lesson,index){
  await ready(lesson);
  await page.evaluate(bundle.outputFiles[0].text+`;window.__vvChaoxingVideo=new VVChaoxingVideo.ChaoxingVideoPage(document,${JSON.stringify(course)},${JSON.stringify(clazz)});`+
    (index===undefined?'':`window.__vvChaoxingVideo.selectVideo(${index});`)+ 'true;',90000);
}
const snapshot=()=>action('return window.__vvChaoxingVideo.snapshot();');
async function hover(){
  signal.throwIfAborted();
  const point=await action('return window.__vvChaoxingVideo.hoverPoint(signal);');
  if(Date.now()-point.captured_at>5000)throw new Error('播放器悬停位置已经失效。');
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
  report.hover_events++;
  const state=await snapshot();
  if(!state.media)throw new Error('正常悬停后实际播放器无法确认。');
  return state.observed_at;
}
async function play(){
  const at=await hover();
  await action(`await window.__vvChaoxingVideo.play(signal,${at},true);return true;`);
}
async function verifyRecord(lesson,index){
  const until=Date.now()+20000;
  let recorded=false;
  while(Date.now()<until){
    signal.throwIfAborted();const state=await snapshot();
    if(!state.media?.ended)throw new Error('核对平台记录时视频结束状态改变。');
    if(state.task_recorded===true){recorded=true;break;}
    await sleep(1000);
  }
  await page.send('Page.reload');
  await bind(lesson,index);
  const state=await snapshot();
  if(state.task_recorded!==true)throw new Error(recorded?'平台任务记录在重新加载后没有保留。':'视频已经播放结束，重新加载后平台任务记录仍未确认。');
  return state;
}
try{
  await page.send('Page.enable');
  const ids=await ownedExtensionIds(connection.profile),vvOptions=`chrome-extension://${ids.vv}/options.html`,speedPopup=`chrome-extension://${ids.speed}/popup.html`;
  for(const url of [vvOptions,speedPopup]){
    if(!targets.some(target=>target.url===url))await browser.send('Target.createTarget',{url,background:true});
  }
  await sleep(500);
  const controls=(await cdpJson(port,'/json/list')).find(target=>target.url===vvOptions);
  const plugin=(await cdpJson(port,'/json/list')).find(target=>target.url===speedPopup);
  if(!controls||!plugin)throw new Error('现有扩展或视频加速插件页面无法确认。');
  const extension=new CdpClient(controls.webSocketDebuggerUrl),speed=new CdpClient(plugin.webSocketDebuggerUrl);
  try{
    report.plugin=await speed.evaluate(`({version:chrome.runtime.getManifest().version,configured_speed:document.querySelector('input[type=text]')?.value})`);
    if(!Number.isFinite(Number(report.plugin.configured_speed))||Number(report.plugin.configured_speed)<=0||Number(report.plugin.configured_speed)>16)throw new Error('Global Speed当前速度配置无效。');
    const muted=await extension.evaluate(`(async()=>{const targets=await chrome.debugger.getTargets();const target=targets.find(target=>target.id===${JSON.stringify(target.id)});if(!target?.tabId)throw Error('课程标签无法确认');const tab=await chrome.tabs.update(target.tabId,{muted:true});return tab.mutedInfo?.muted===true;})()`);
    if(!muted)throw new Error('课程标签静音未确认。');
  }finally{extension.close();speed.close();}
  report.browser_window=await browser.send('Browser.getWindowForTarget',{targetId:target.id});
  const initial=await read();
  if(!initial)throw new Error('当前课时尚未读取。');
  await bind(initial.lesson_id,0);
  const lessons=await action('return window.__vvChaoxingVideo.lessons();');
  if(!lessons.length||lessons.some(lesson=>lesson.locked))throw new Error('课时目录为空或含锁定任务。');
  report.lessons=lessons;
  const at=lessons.findIndex(lesson=>lesson.id===initial.lesson_id);
  if(at<0)throw new Error('当前课时不在已确认目录中。');
  const ordered=[...lessons.slice(at),...lessons.slice(0,at)];
  await save({phase:'started',plugin:report.plugin,lesson_count:lessons.length,initial_lesson:initial.lesson_id});
  console.log(JSON.stringify({report:reportPath,phase:'started',plugin:report.plugin,lesson_count:lessons.length}));
  for(const lesson of ordered){
    signal.throwIfAborted();
    await action(`window.__vvChaoxingVideo.selectLesson(${JSON.stringify(lesson.id)},${JSON.stringify(lesson.title)},signal);return true;`);
    const reading=await ready(lesson.id);
    await bind(lesson.id);
    await save({phase:'lesson',lesson:lesson.id,title:lesson.title,video_count:reading.videos.length});
    for(let index=0;index<reading.videos.length;index++){
      await bind(lesson.id,index);
      let state=await snapshot();
      if(state.task_recorded===true){report.results.push({lesson:lesson.id,index,outcome:'existing_record'});continue;}
      if(state.task_recorded!==false||!state.media)throw new Error('视频任务或媒体状态未知。');
      await play();
      let progressAt=Date.now(),lastPosition=state.media.position,lastSampleAt=Date.now(),lastOutput=0;
      while(true){
        signal.throwIfAborted();
        await hover();state=await snapshot();
        if(state.lesson_id!==lesson.id||state.index!==index||!state.media)throw new Error('播放中的课时或视频身份改变。');
        if(state.blocked)throw new Error('视频出现弹题或提示，需要核对后继续。');
        const now=Date.now(),observedRate=(state.media.position-lastPosition)/((now-lastSampleAt)/1000);
        if(state.media.position>lastPosition)progressAt=now;
        if(now-lastOutput>=5000||state.media.ended){
          await save({phase:'playing',state,observed_rate:observedRate});
          console.log(JSON.stringify({phase:'playing',lesson:lesson.id,hidden:state.hidden,position:state.media.position,duration:state.media.duration,
            reported_rate:state.media.rate,observed_rate:observedRate,paused:state.media.paused,recorded:state.task_recorded}));lastOutput=now;
        }
        lastPosition=state.media.position;lastSampleAt=now;
        if(state.media.ended)break;
        if(now-progressAt>120000)throw new Error('视频连续两分钟没有实际进展，停止自动播放。');
        if(state.media.paused)await play();
        await sleep(1000);
      }
      const ended=state;
      const recorded=await verifyRecord(lesson.id,index);
      report.results.push({lesson:lesson.id,title:lesson.title,index,outcome:'completed',ended,recorded});
      await save({phase:'video_recorded',lesson:lesson.id,index});
      console.log(JSON.stringify({phase:'video_recorded',lesson:lesson.id,index,completed:report.results.length}));
    }
    const after=await read();
    if(after?.lesson_id!==lesson.id)throw new Error('记录关联测验时课时身份改变。');
    for(const quiz of after.quizzes)report.quizzes.push({lesson:lesson.id,index:quiz.index,recorded:quiz.task_recorded,
      status:quiz.status,submission_confirmed:quiz.submission_confirmed,score:quiz.score,attempt:quiz.attempt});
  }
  report.video_scope_complete=true;
}catch(error){
  report.error=error instanceof Error?error.message:String(error);throw error;
}finally{
  try{
    const url=new URL((await page.send('Page.getFrameTree')).frameTree.frame.url);
    if(url.origin==='https://mooc1.chaoxing.com'&&url.searchParams.get('courseId')===course){
      await page.evaluate(bundle.outputFiles[0].text+`;new VVChaoxingVideo.ChaoxingVideoPage(document,${JSON.stringify(course)},${JSON.stringify(clazz)}).pauseAll(new AbortController().signal);`);
      report.safe_state=await read();
    }
  }catch(error){report.pause_error=error instanceof Error?error.message:String(error);throw error;}
  finally{
    page.close();browser.close();report.finished_at=new Date().toISOString();report.log=log;
    await writeFile(reportPath,JSON.stringify(report,null,2),{flag:'wx'});
    console.log(JSON.stringify({report:reportPath,video_scope_complete:report.video_scope_complete??false,error:report.error??null,verified_videos:report.results.length}));
  }
}
