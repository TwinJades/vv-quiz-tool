import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

import { generateIcons } from "./generate-icons.mjs";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, process.env.VV_BUILD_DIR || "dist");
await mkdir(outputDirectory, { recursive: true });
await generateIcons(resolve(root, "static"));

const common = {
  bundle: true,
  target: "chrome120",
  sourcemap: false,
  minify: false,
  legalComments: "none",
};

await Promise.all([
  build({
    ...common,
    entryPoints: [resolve(root, "src/extension/background.ts")],
    outfile: resolve(outputDirectory, "background.js"),
    format: "esm",
  }),
  build({
    ...common,
    entryPoints: [resolve(root, "src/extension/content.ts")],
    outfile: resolve(outputDirectory, "content.js"),
    format: "iife",
  }),
  build({
    ...common,
    entryPoints: [resolve(root, "src/extension/popup.ts")],
    outfile: resolve(outputDirectory, "popup.js"),
    format: "iife",
  }),
  build({
    ...common,
    entryPoints: [resolve(root, "src/extension/options.ts")],
    outfile: resolve(outputDirectory, "options.js"),
    format: "iife",
  }),
  build({ ...common, entryPoints: [resolve(root, "src/extension/tasks.ts")], outfile: resolve(outputDirectory, "tasks.js"), format: "iife" }),
]);

for (const file of [
  "manifest.json",
  "popup.html",
  "options.html",
  "tasks.html",
  "ui.css",
  "icon.svg",
  "icon16.png",
  "icon32.png",
  "icon48.png",
  "icon128.png",
]) {
  await cp(resolve(root, "static", file), resolve(outputDirectory, file), { force: true });
}
