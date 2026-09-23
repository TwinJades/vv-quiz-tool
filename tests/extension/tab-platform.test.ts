import { afterEach, describe, expect, it, vi } from "vitest";

import { TabPlatformProxy } from "../../src/extension/tab-platform";

afterEach(() => vi.unstubAllGlobals());

describe("semantic snapshot session input", () => {
  it("sends the page context only on the first question when local extraction stays valid", async () => {
    const modes: string[] = [];
    const sendMessage = vi.fn(async (_tabId: number, request: { type: string; mode?: string }) => {
      if (request.type === "VV_CAPTURE_SEPARATION") {
        return { ok: true, result: { suggested: false, snapshot: { visible_text: "", candidates: [] } } };
      }
      modes.push(request.mode!);
      return { ok: true, result: {
        surface_origin: "https://quiz.example",
        ...(request.mode === "semantic_snapshot" ? { page_context: { mode: "semantic_snapshot", visible_text: "page", controls: [], media: [] } } : {}),
      } };
    });
    vi.stubGlobal("chrome", { tabs: { sendMessage } });
    const platform = new TabPlatformProxy(1, "semantic_snapshot");

    const first = await platform.observeSession("s1", new AbortController().signal);
    const second = await platform.observeSession("s1", new AbortController().signal);

    expect(modes).toEqual(["semantic_snapshot", "structured"]);
    expect(first.page_context?.visible_text).toBe("page");
    expect(second.page_context).toBeUndefined();
  });
});
