import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CdpClient,cdpJson} from './cdp-client.mjs';
import {ownedBrowserConnection,ownedExtensionIds} from './owned-browser.mjs';

const root=resolve(import.meta.dirname,'..');
const command=process.argv[2];
if(!['inspect','status','verify'].includes(command))throw new Error('需要指定inspect、status或verify，操作均只读。');
const option=process.argv.find(argument=>argument.startsWith('--connection='));
const connectionPath=resolve(root,option?.slice('--connection='.length)??'.browser-regression-runtime/course-login-20261004-040551/connection-login-ready.json');
const connection=await ownedBrowserConnection(connectionPath);
const run=resolve(connection.run_directory),profile=resolve(connection.profile);
if(connection.scope!=='owned-isolated-course-materials'||!run.startsWith(resolve(root,'.browser-regression-runtime')+'\\')||profile!==resolve(run,'profile'))
  throw new Error('自有课程连接身份失配。');
const port=connection.port;
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('当前隔离浏览器调试端口无效。');
const compiled=await build({entryPoints:[resolve(root,'src/web/course-inspection.ts')],bundle:true,write:false,format:'iife',globalName:'VVCourseInspection',target:'chrome120'});
const targets=await cdpJson(port,'/json/list');
const pages=targets.filter(target=>target.type==='page'&&/^https:\/\/[^/]+\.(chaoxing|zhihuishu)\.com\//.test(target.url));
if(!pages.length)throw new Error('自有浏览器没有课程平台页面。');
const readings=[];
const production=[];
for(const target of pages){
  const page=new CdpClient(target.webSocketDebuggerUrl);
  try{
    const tree=await page.send('Page.getFrameTree');
    const frames=[];
    const visit=node=>{frames.push(node.frame);for(const child of node.childFrames??[])visit(child);};
    visit(tree.frameTree);
    for(const frame of frames.filter(frame=>/^https:\/\/[^/]+\.(chaoxing|zhihuishu)\.com\//.test(frame.url))){
      const world=await page.send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'vv-course-read-only'});
      const response=await page.send('Runtime.evaluate',{contextId:world.executionContextId,returnByValue:true,
        expression:compiled.outputFiles[0].text+';VVCourseInspection.inspectCoursePage(document)'});
      if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);
      readings.push({target_id:target.id,frame_id:frame.id,inspection:response.result.value});
    }
  }finally{page.close();}
}
if(!readings.length)throw new Error('没有成功读取课程平台frame。');
const summary=readings.map(({target_id,frame_id,inspection:r})=>({target_id,frame_id,platform:r.platform,path:r.path,visibility:r.visibility,
  closed:r.closed,directory:r.chaoxing_directory??r.zhidao_directory,learning:r.chaoxing_learning,navigation:r.zhidao_navigation,
  player:r.zhidao_player,practice:r.chaoxing_practice??r.zhidao_practice,review:r.chaoxing_review??r.zhidao_review,limitations:r.limitations}));
if(command==='verify'){
  const ids=await ownedExtensionIds(profile),buildInfo=JSON.parse(await readFile(resolve(root,'dist/build-info.json'),'utf8'));
  const options=targets.filter(target=>target.type==='page'&&target.url===`chrome-extension://${ids.vv}/options.html`);
  if(options.length!==1)throw new Error('请在自有浏览器打开当前VV设置页面，再核对正式入口。');
  const extension=new CdpClient(options[0].webSocketDebuggerUrl);
  try {
    const actual=await extension.evaluate(`(async()=>{const build=await chrome.runtime.sendMessage({type:'VV_GET_BUILD'});if(!build.ok)throw Error(build.error);return {build:build.result,version:chrome.runtime.getManifest().version,tabs:(await chrome.tabs.query({})).map(tab=>({id:tab.id,url:tab.url}))};})()`);
    if(actual.build.build_id!==buildInfo.build_id||buildInfo.test_build!==false)throw new Error('浏览器加载的扩展与正式dist构建不一致。');
    for(const target of pages){
      const tab=actual.tabs.filter(tab=>tab.url===target.url);if(tab.length!==1)throw new Error('课程标签身份不唯一。');
      const result=await extension.evaluate(`chrome.runtime.sendMessage({type:'VV_PREVIEW_COURSE',tab_id:${tab[0].id}})`);
      if(!result.ok)throw new Error(result.error);
      const catalog=result.result;
      if(!catalog.complete||catalog.diagnostics.length||!catalog.tasks.length||catalog.tasks.some(task=>task.kind!=='lesson')||new Set(catalog.tasks.map(task=>task.id)).size!==catalog.tasks.length)throw new Error('正式课程入口没有返回完整的本次课时范围。');
      production.push({tab_id:tab[0].id,catalog});
    }
    const file=resolve(run,`course-production-entry-${Date.now()}.json`);
    await writeFile(file,JSON.stringify({captured_at:new Date().toISOString(),version:actual.version,build_id:actual.build.build_id,readings,production,verification:'正式构建与真实页面目录读取；没有播放、作答、提交或模型请求。'},null,2),{flag:'wx'});
    console.log(JSON.stringify({file,version:actual.version,build_id:actual.build.build_id,production}));
  } finally {extension.close();}
}else if(command==='inspect'){
  const file=resolve(run,`course-inspection-${Date.now()}.json`);
  await writeFile(file,JSON.stringify({captured_at:new Date().toISOString(),readings},null,2),{flag:'wx'});
  console.log(JSON.stringify({file,summary}));
}else console.log(JSON.stringify({summary}));
