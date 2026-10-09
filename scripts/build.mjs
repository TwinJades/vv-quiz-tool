import { cp, mkdir, readFile, writeFile,rename,lstat } from "node:fs/promises";
import { createHash } from 'node:crypto';
import { resolve,relative,isAbsolute,dirname } from "node:path";

import { build } from "esbuild";

import { generateIcons } from "./generate-icons.mjs";
import {sourceFingerprint} from './source-fingerprint.mjs';

const root = resolve(import.meta.dirname, "..");
const destination=resolve(root,process.env.VV_BUILD_DIR||'dist');
const relativeDestination=relative(root,destination);
if(!relativeDestination||relativeDestination.startsWith('..')||isAbsolute(relativeDestination))throw new Error('Build destination must be inside this workspace.');
if(destination!==resolve(root,'dist')&&!destination.startsWith(resolve(root,'.browser-regression-runtime')+'\\'))throw new Error('Build destination must be dist or an owned test runtime.');
for(let path=destination;path!==dirname(root);path=dirname(path)){
  try{if((await lstat(path)).isSymbolicLink())throw new Error('Build path contains a reparse point.');}catch(error){if(error.code!=='ENOENT')throw error;}
}
const runDirectory=resolve(root,'.browser-regression-runtime',`build-${Date.now()}-${process.pid}`);
const outputDirectory=resolve(runDirectory,'extension');
await mkdir(outputDirectory, { recursive: true });
await generateIcons(resolve(root, "static"));

const buildId = await sourceFingerprint(root);

const common = {
  bundle: true,
  target: "chrome120",
  sourcemap: false,
  minify: true,
  legalComments: "none",
  define: { __VV_BUILD_ID__: JSON.stringify(buildId),__VV_TEST_BUILD__:process.env.VV_TEST_BUILD==='1'?'true':'false' },
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
  "_locales",
]) {
  await cp(resolve(root, "static", file), resolve(outputDirectory, file), { force: true, recursive: true });
}

const artifacts = {};
for (const name of ['background.js', 'content.js', 'popup.js', 'tasks.js', 'options.js']) {
  artifacts[name] = createHash('sha256').update(await readFile(resolve(outputDirectory, name))).digest('hex');
}
await writeFile(resolve(outputDirectory, 'build-info.json'), JSON.stringify({ build_id: buildId, built_at: new Date().toISOString(), strategy: 'unattended',test_build:process.env.VV_TEST_BUILD==='1', artifacts }, null, 2));
let existing=false;
try {const stat=await lstat(destination);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Build destination is not an ordinary directory.');existing=true;}catch(error){if(error.code!=='ENOENT')throw error;}
const previous=resolve(runDirectory,'previous');
await mkdir(dirname(destination),{recursive:true});
if(existing)await rename(destination,previous);
try{await rename(outputDirectory,destination);}catch(error){if(existing)await rename(previous,destination);throw error;}
await writeFile(resolve(runDirectory,'report.json'),JSON.stringify({build_id:buildId,destination,previous:existing?previous:null},null,2));
