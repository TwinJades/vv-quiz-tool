import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const readTestNotices = 'chrome.storage.session.get(null).then(data=>Object.entries(data).filter(([key])=>key.startsWith("vv-test-notice:")).map(([,value])=>value))';

export function notificationRecordingBundle(bundle) {
  return bundle;
}

// Call only for a freshly built, owned test directory, never the user's dist.
export async function installTestNotificationRecorder(directory) {
  const info=JSON.parse(await readFile(resolve(directory,'build-info.json'),'utf8'));
  if(info.test_build!==true)throw new Error('Notification recording requires an owned diagnostic build.');
}
