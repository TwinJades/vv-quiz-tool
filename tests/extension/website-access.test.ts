import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCurrentWebsite, requireCurrentWebsite, websitePermissionOrigin } from "../../src/extension/website-access";
afterEach(() => vi.unstubAllGlobals());
describe("current website authorization", () => {
  it("accepts only ordinary HTTP(S) origins", () => {
    expect(websitePermissionOrigin("https://example.test/quiz?q=1")).toBe("https://example.test/*");
    for (const url of ["chrome://settings", "file:///quiz.html", "http-invalid", "httpsx://example.test"]) expect(websitePermissionOrigin(url)).toBeNull();
  });
  it("refuses programmatic resume without granting permission", async () => {
    const request = vi.fn();
    vi.stubGlobal("chrome", { tabs: { get: async () => ({}) }, webNavigation: { getFrame: async () => ({ url: "https://new.test/quiz" }) }, permissions: { contains: async () => false, request } });
    await expect(requireCurrentWebsite(1)).rejects.toThrow("尚未授权");
    expect(request).not.toHaveBeenCalled();
  });
  it("requests the current website and iframe origins once and reports a denial", async () => {
    const request = vi.fn(async () => false);
    vi.stubGlobal("chrome", { tabs: { get: async () => ({ url: "https://new.test/quiz" }) }, webNavigation: { getAllFrames: async () => [{ url: "https://embed.test/quiz" }, { url: "about:blank" }, { url: "https://new.test/quiz" }] }, permissions: { contains: async () => false, request } });
    await expect(requestCurrentWebsite(1)).rejects.toThrow("需要当前网站权限");
    expect(request).toHaveBeenCalledExactlyOnceWith({ origins: ["https://new.test/*", "https://embed.test/*"] });
  });
  it("does not prompt when the required origins already have permission", async () => {
    const request = vi.fn();
    vi.stubGlobal("chrome", { tabs: { get: async () => ({ url: "https://old.test/quiz" }) }, webNavigation: { getAllFrames: async () => [], getFrame: async () => ({ url: "https://old.test/quiz" }) }, permissions: { contains: async () => true, request } });
    await requestCurrentWebsite(1); await requireCurrentWebsite(1);
    expect(request).not.toHaveBeenCalled();
  });
  it("uses the main navigation URL when a pending ungranted navigation still exposes an old frame", async () => {
    vi.stubGlobal("chrome", { tabs: { get: async () => ({ url: "https://old.test/quiz" }) }, webNavigation: { getFrame: async () => ({ url: "https://old.test/quiz" }) }, permissions: { contains: async ({ origins }: { origins: string[] }) => origins[0] === "https://old.test/*" } });
    await expect(requireCurrentWebsite(1, "https://new.test/quiz")).rejects.toThrow("尚未授权");
  });
  it("can request an ungranted main origin even when tabs.get hides the URL", async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal("chrome", { tabs: { get: async () => ({}) }, webNavigation: { getAllFrames: async () => [{ frameId: 0, url: "https://new.test/quiz" }] }, permissions: { contains: async () => false, request } });
    await requestCurrentWebsite(1);
    expect(request).toHaveBeenCalledExactlyOnceWith({ origins: ["https://new.test/*"] });
  });
});
