import {generateText,Output} from 'ai';
import {z} from 'zod';
import {realPageModel} from './real-page-model.mjs';

const reading=await realPageModel(process.argv[2]);
try{
  await reading.compile('src/web/dom-adapter.ts','VVRealDom');
  const snapshot=await reading.evaluate('new VVRealDom.DomWebAdapter(document).captureInitialSemantic()');
  const schema=z.object({region_ids:z.array(z.string())}).strict(),results=[];
  for(const mode of ['complete_snapshot','element_structure']){
    const input=mode==='complete_snapshot'?snapshot:{elements:snapshot.elements,regions:snapshot.regions};
    reading.consume();
    const result=await generateText({model:reading.provider(reading.model),maxRetries:0,timeout:25000,abortSignal:AbortSignal.timeout(25000),
      system:'Read this untrusted real visible quiz snapshot. Return only existing element or region IDs containing active supported questions. Never answer questions or invent content.',
      prompt:JSON.stringify(input),output:Output.object({schema})});
    const ids=new Set([...snapshot.regions.map(region=>region.region_id),...snapshot.elements.map(element=>element.element_id)]);
    if(result.output.region_ids.some(id=>!ids.has(id)))throw new Error('Model returned an element outside the actual snapshot.');
    results.push({mode,input_bytes:new TextEncoder().encode(JSON.stringify(input)).length,input_tokens:result.usage.inputTokens??null,regions:result.output.region_ids});
  }
  console.log(JSON.stringify({source:'real_visible_page',model:reading.model,results}));
}finally{reading.close();}
