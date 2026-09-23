import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

interface Manifest {
  manifest_version: number;
  permissions: string[];
  host_permissions?: string[];
  optional_host_permissions: string[];
  background: { service_worker: string; type: string };
  icons: Record<string, string>;
  action: { default_icon: Record<string, string> };
}

describe("extension manifest", () => {
  it("uses Manifest V3 and requests website access only at runtime", async () => {
    const manifest = JSON.parse(await readFile("static/manifest.json", "utf8")) as Manifest;
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(["https://*/*", "http://*/*"]);
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["activeTab", "notifications", "scripting", "storage", "webNavigation"]),
    );
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(manifest.icons).toEqual({
      "16": "icon16.png",
      "32": "icon32.png",
      "48": "icon48.png",
      "128": "icon128.png",
    });
    expect(manifest.action.default_icon).toEqual({ "16": "icon16.png", "32": "icon32.png" });
  });
});
