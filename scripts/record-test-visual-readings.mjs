import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only the owned acceptance build records model readings for diagnosis. No keys,
// HTTP headers, screenshots or Provider config are included; product is unchanged.
export async function installTestVisualRecorder(directory) {
  const path = resolve(directory, 'background.js');
  const source = await readFile(path, 'utf8');
  const marker = 'return decodeVisualReading(result.output, capture);';
  if (source.split(marker).length !== 2) throw new Error('Expected one visual recognition return in isolated build');
  const captureMarker = 'this.#viewportContextSent = true;';
  if(source.split(captureMarker).length !== 2) throw new Error('Expected one visual capture return in isolated build');
  const recorder = 'globalThis.__vvTestPixels=[];globalThis.__vvRecordPixels=(data,meta)=>{let binary="";for(const byte of data)binary+=String.fromCharCode(byte);const records=globalThis.__vvTestPixels;records.push({...meta,index:records.length,png:btoa(binary)});if(records.length>80)records.shift()};\n';
  await writeFile(path, recorder + source.replace(marker, `await chrome.storage.session.set({["vv-test-visual:"+crypto.randomUUID()]:{session_id:capture.frame.session_id,at:Date.now(),width:capture.frame.width,height:capture.frame.height,reading:result.output}}); ${marker}`)
    .replace(captureMarker, 'if(viewport_context)globalThis.__vvRecordPixels(viewport_context.data,{session_id:sessionId,at:Date.now(),width:viewport_context.width,height:viewport_context.height,purpose:"initial_viewport_context",geometry:{...geometry,region:{x:0,y:0,width:geometry.viewport.width,height:geometry.viewport.height}}});globalThis.__vvRecordPixels(data,{session_id:sessionId,at:Date.now(),width,height,geometry}); '+captureMarker));
}
export const readTestVisualReadings = 'chrome.storage.session.get(null).then(data=>Object.entries(data).filter(([key])=>key.startsWith("vv-test-visual:")).map(([,value])=>value))';
