import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Observe actual adapter transitions only in an isolated acceptance build.
// Never retain prompts, secrets, answers, question content or hidden solutions.
export async function installTestDomRecorder(directory){
  const path=resolve(directory,'content.js'),source=await readFile(path,'utf8');
  const marker='const adapter = new DomWebAdapter(document);';
  if(source.split(marker).length!==2)throw new Error('Private DOM recorder installation point is ambiguous');
  const recorder=`
    globalThis.__vvTestDomTransitions ??= [];
    let lastDomState;
    const pushDom = entry=>{const rows=globalThis.__vvTestDomTransitions;if(rows.length<500)rows.push({at:Date.now(),...entry});};
    const readDomState=DomWebAdapter.prototype.readState;
    DomWebAdapter.prototype.readState=async function(signal){
      const state=await readDomState.call(this,signal);
      const entry={kind:'state',fingerprint:state.fingerprint,feedback:state.feedback,feedback_text:state.feedback_text??'',score:state.visible_score??null,can_retry:state.can_retry,has_next:state.has_next,has_session_submit:state.has_session_submit??false,completed:state.completed,field_ids:Object.keys(state.field_values)};
      const key=JSON.stringify(entry);if(key!==lastDomState){lastDomState=key;pushDom(entry);}return state;
    };
    const executeDom=DomWebAdapter.prototype.execute;
    DomWebAdapter.prototype.execute=async function(plan,locator,signal){
      const entry={kind:'execute',actions:plan.actions.map(a=>({kind:a.kind,target:a.target_id})),fingerprint:locator.question_fingerprint};
      try{const result=await executeDom.call(this,plan,locator,signal);pushDom({...entry,result});return result;}
      catch(error){pushDom({...entry,error:error.message});throw error;}
    };
  `;
  await writeFile(path,source.replace(marker,recorder+marker));
}
