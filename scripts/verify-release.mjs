import {readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {sourceFingerprint} from './source-fingerprint.mjs';

const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist');
const info=JSON.parse(await readFile(resolve(dist,'build-info.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(dist,'manifest.json'),'utf8'));
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
if(info.test_build!==false||info.build_id!==await sourceFingerprint(root))throw new Error('dist与当前源码构建不一致。');
if(manifest.version!==pkg.version||manifest.manifest_version!==3)throw new Error('发行版本或Manifest版本不一致。');
const scripts=['background.js','content.js','popup.js','tasks.js','options.js'];
if(JSON.stringify(Object.keys(info.artifacts).sort())!==JSON.stringify([...scripts].sort()))throw new Error('发行脚本清单不完整。');
for(const script of scripts)if(createHash('sha256').update(await readFile(resolve(dist,script))).digest('hex')!==info.artifacts[script])throw new Error('发行脚本SHA256不一致：'+script);
const references=[manifest.background.service_worker,manifest.action.default_popup,manifest.options_page,...manifest.content_scripts?.flatMap(item=>item.js)??[],...Object.values(manifest.icons)];
for(const name of references.filter(Boolean)){const path=resolve(dist,name);if(relative(dist,path).startsWith('..')||(await lstat(path)).isSymbolicLink()||!(await lstat(path)).isFile())throw new Error('扩展引用文件不存在或越界：'+name);}
async function verifyStatic(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name),target=resolve(dist,relative(resolve(root,'static'),path));
    if(entry.isSymbolicLink())throw new Error('静态资料存在重解析路径。');
    if(entry.isDirectory())await verifyStatic(path);else if(entry.isFile()&&!Buffer.from(await readFile(path)).equals(await readFile(target)))throw new Error('发行静态文件与源码不一致：'+entry.name);
  }
}
await verifyStatic(resolve(root,'static'));
console.log(JSON.stringify({version:manifest.version,build_id:info.build_id,artifacts_verified:scripts.length,static_verified:true,test_build:info.test_build}));
