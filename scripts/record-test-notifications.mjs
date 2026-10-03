import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const readTestNotices = 'chrome.storage.session.get(null).then(data=>Object.entries(data).filter(([key])=>key.startsWith("vv-test-notice:")).map(([,value])=>value))';

export function notificationRecordingBundle(bundle) {
  const call = 'await chrome.notifications.create(';
  if (bundle.split(call).length !== 2) throw new Error('Expected one explicit notification call in isolated build');
  const recorder = 'globalThis.__vvTestNotify=async(id,options)=>{await chrome.storage.session.set({["vv-test-notice:"+crypto.randomUUID()]:{id,...options}});return id};\n';
  return recorder + bundle.replace(call, 'await globalThis.__vvTestNotify(');
}

// Call only for a freshly built, owned test directory, never the user's dist.
export async function installTestNotificationRecorder(directory) {
  const path = resolve(directory, 'background.js');
  await writeFile(path, notificationRecordingBundle(await readFile(path, 'utf8')));
}
