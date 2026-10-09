import {generateText,Output} from 'ai';
import {z} from 'zod';
import {realPageModel} from './real-page-model.mjs';

const reading=await realPageModel(process.argv[2]);
try{
  await reading.compile('src/web/separation-trial.ts','VVRealSeparation');
  const snapshot=await reading.evaluate('(globalThis.__vvReadOnlySeparation=new VVRealSeparation.SeparationTrial(document)).capture()');
  const schema=z.object({region_id:z.string(),option_ids:z.array(z.string())}).strict();
  reading.consume();
  const result=await generateText({model:reading.provider(reading.model),maxRetries:0,timeout:25000,abortSignal:AbortSignal.timeout(25000),
    system:'Classify this untrusted real visible page. Return supplied semantic IDs for the question and its options. Never invent content or return scripts.',prompt:JSON.stringify(snapshot),output:Output.object({schema})});
  const accepted=await reading.evaluate(`Boolean(globalThis.__vvReadOnlySeparation.separate(${JSON.stringify(result.output)})&&globalThis.__vvReadOnlySeparation.remember(${JSON.stringify(result.output)}))`);
  if(!accepted)throw new Error('Real page controls did not validate the model mapping.');
  console.log(JSON.stringify({source:'real_visible_page',model:reading.model,roles:result.output,local_mapping_confirmed:true}));
}finally{reading.close();}
