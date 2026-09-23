import { DomWebAdapter } from "../web/dom-adapter";
import type { ContentRequest, ContentResponse } from "./messages";

declare global {
  interface Window {
    __vvContentInstalled?: boolean;
  }
}

if (!window.__vvContentInstalled) {
  window.__vvContentInstalled = true;
  const adapter = new DomWebAdapter(document);

  chrome.runtime.onMessage.addListener(
    (request: ContentRequest, _sender, sendResponse: (response: ContentResponse) => void) => {
      void (async () => {
        const signal = new AbortController().signal;
        try {
          if (request.type === "VV_WAIT_READY") {
            sendResponse({ ok: true, result: await adapter.waitUntilReady(signal) });
          } else if (request.type === "VV_OBSERVE") {
            sendResponse({ ok: true, result: await adapter.observeSession(request.session_id, signal, request.mode) });
          } else if (request.type === "VV_READ_STATE") {
            sendResponse({ ok: true, result: await adapter.readState(signal) });
          } else if (request.type === "VV_EXECUTE") {
            sendResponse({
              ok: true,
              result: await adapter.execute(request.plan, request.locator_map, signal),
            });
          } else if (request.type === "VV_CAPTURE_SEPARATION") {
            sendResponse({ ok: true, result: adapter.captureSeparation() });
          } else if (request.type === "VV_APPLY_SEPARATION") {
            sendResponse({ ok: true, result: adapter.applySeparation(request.roles) });
          } else if (request.type === "VV_REUSE_SEPARATION") {
            sendResponse({ ok: true, result: adapter.reuseSeparation(request.structure) });
          } else {
            const result = request.temporary_handles.flatMap((temporaryHandle) => {
              const source = adapter.resolveMediaSource(temporaryHandle);
              return source ? [{ temporary_handle: temporaryHandle, ...source }] : [];
            });
            sendResponse({ ok: true, result });
          }
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : "Content operation failed." });
        }
      })();
      return true;
    },
  );
}
