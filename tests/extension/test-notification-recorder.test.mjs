import { describe, expect, it } from 'vitest';
import { notificationRecordingBundle } from '../../scripts/record-test-notifications.mjs';
describe('owned test notification transport', () => {
  it('preserves native notification delivery in diagnostic builds', () => {
    const bundle='async function notify(){await chrome.notifications.create("id", {title:"Attention"});}';
    expect(notificationRecordingBundle(bundle)).toBe(bundle);
  });
  it('preserves arbitrary compiled identifiers without inspecting call-site strings', () => {
    const bundle='await c.notifications.create("a");await c.notifications.create("b");';
    expect(notificationRecordingBundle(bundle)).toBe(bundle);
  });
});
