import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only the owned acceptance build records model readings for diagnosis. No keys,
// HTTP headers, screenshots or Provider config are included; product is unchanged.
export async function installTestVisualRecorder(directory) {
  const info=JSON.parse(await readFile(resolve(directory,'build-info.json'),'utf8'));
  if(info.test_build!==true)throw new Error('Visual recording requires an owned diagnostic build.');
}
export const readTestVisualReadings = 'chrome.storage.session.get(null).then(data=>Object.entries(data).filter(([key])=>key.startsWith("vv-test-visual:")).map(([,value])=>value))';
