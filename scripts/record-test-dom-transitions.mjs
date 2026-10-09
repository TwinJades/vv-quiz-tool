import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Observe actual adapter transitions only in an isolated acceptance build.
// Never retain prompts, secrets, answers, question content or hidden solutions.
export async function installTestDomRecorder(directory){
  const info=JSON.parse(await readFile(resolve(directory,'build-info.json'),'utf8'));
  if(info.test_build!==true)throw new Error('DOM recording requires an owned diagnostic build.');
}
