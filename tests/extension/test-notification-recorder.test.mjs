import { describe, expect, it } from 'vitest';
import { notificationRecordingBundle } from '../../scripts/record-test-notifications.mjs';
describe('owned test notification transport', () => {
  it('removes the native notification call and records requests without an OS sender', () => {
    const output = notificationRecordingBundle('async function notify(){await chrome.notifications.create("id", {title:"Attention"});}');
    expect(output).not.toContain('chrome.notifications.create');
    expect(output).toContain('await globalThis.__vvTestNotify("id"');
    expect(output).toContain('chrome.storage.session.set');
  });
  it('refuses changed or ambiguous compiled call sites before a browser can launch', () => {
    expect(() => notificationRecordingBundle('const otherBuild=true;')).toThrow('Expected one');
    expect(() => notificationRecordingBundle('await chrome.notifications.create("a");await chrome.notifications.create("b");')).toThrow('Expected one');
  });
});
