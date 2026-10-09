import {resolve} from 'node:path';
import {build} from 'esbuild';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {CdpClient,cdpJson} from './cdp-client.mjs';
import {ownedBrowserConnection,ownedExtensionIds} from './owned-browser.mjs';
import {assertAcceptanceProvider,authorizedTestModel} from './authorized-test-model.mjs';

export async function realPageModel(url){
  if(typeof url!=='string'||!/^https?:\/\//.test(url))throw new Error('Provide the exact URL of an already opened real quiz page.');
  const root=resolve(import.meta.dirname,'..');
  const connection=await ownedBrowserConnection(process.env.VV_BROWSER_CONNECTION??'.browser-regression-runtime/course-login-20261004-040551/connection-login-ready.json');
  const targets=await cdpJson(connection.port,'/json/list'),ids=await ownedExtensionIds(connection.profile);
  const options=targets.filter(target=>target.url===`chrome-extension://${ids.vv}/options.html`),pages=targets.filter(target=>target.type==='page'&&target.url===url);
  if(options.length!==1||pages.length!==1)throw new Error('The owned VV options page and target quiz must already be uniquely open.');
  const extension=new CdpClient(options[0].webSocketDebuggerUrl);let config;
  try{config=await extension.evaluate(`(async()=>{const data=await chrome.storage.local.get(null);const id=data['provider-profile-index']?.find(id=>data['provider-profile:'+id]?.display_name==='CPA');if(!id)throw Error('CPA profile missing');const profile=data['provider-profile:'+id];return {profile,key:data['provider-secret:'+profile.secret_ref]};})()`);}finally{extension.close();}
  assertAcceptanceProvider(config.profile);
  const response=await fetch(config.profile.base_url+'/models',{headers:{Authorization:'Bearer '+config.key},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('EasyCPA model directory is unavailable.');
  const catalog=await response.json();if(!Array.isArray(catalog.data))throw new Error('EasyCPA returned an invalid model directory.');
  const model=authorizedTestModel({configured:config.profile.model_catalog.models,available:catalog.data.map(item=>item.id),requested:process.env.VV_TEST_MODEL}).id;
  const page=new CdpClient(pages[0].webSocketDebuggerUrl);
  let world;
  try {const tree=await page.send('Page.getFrameTree');world=await page.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'vv-real-read-only'});}
  catch(error){page.close();throw error;}
  const evaluate=async expression=>{const result=await page.send('Runtime.evaluate',{expression,contextId:world.executionContextId,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error('Real page observation failed.');return result.result.value;};
  const compile=async(file,name)=>{
    const result=await build({entryPoints:[resolve(root,file)],bundle:true,write:false,format:'iife',globalName:name,target:'chrome120',define:{__VV_TEST_BUILD__:'false'}});
    await evaluate(result.outputFiles[0].text);
  };
  let calls=0;
  return {page,model,provider:createOpenAICompatible({name:'vv-real-page',baseURL:config.profile.base_url,apiKey:config.key,supportsStructuredOutputs:true}),evaluate,compile,
    consume(){if(++calls>2)throw new Error('Real page comparison model budget exceeded.');},close(){page.close();}};
}
