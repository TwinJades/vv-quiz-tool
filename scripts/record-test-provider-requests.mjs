import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Owned acceptance build only. Record timing/status to diagnose overlap without
// retaining URLs, prompts, answers, keys, headers or response bodies.
export async function installTestProviderRecorder(directory) {
  const path=resolve(directory,'background.js');
  const source=await readFile(path,'utf8');
  if(source.includes('__vvTestProviderRequests'))throw new Error('Provider recorder already installed');
  const recorder=`{
    const originalFetch=globalThis.fetch.bind(globalThis);
    let active=0;
    globalThis.__vvTestProviderRequests=[];
    globalThis.fetch=async function(input,init){
      let model;
      try{const path=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url).pathname;
        if(path.endsWith('/chat/completions')&&typeof init?.body==='string')model=JSON.parse(init.body).model;
      }catch{}
      if(typeof model!=='string'||!/^gemini-3\\.(?:8-flash|7-flash|1-pro)(?:-|$)/.test(model))return originalFetch(input,init);
      const record={model,started_at:Date.now(),concurrent_at_start:++active,status:null,finished_at:null,error:null};
      globalThis.__vvTestProviderRequests.push(record);
      try{const response=await originalFetch(input,init);record.status=response.status;return response;}
      catch(error){record.error=error?.name??'Error';throw error;}
      finally{record.finished_at=Date.now();active--;}
    };
  }\n`;
  await writeFile(path,recorder+source);
}
