import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';

const root=resolve(import.meta.dirname,'..');
const files=[];
async function check(directory){
  for(const item of await readdir(directory,{withFileTypes:true})){
    if(item.isSymbolicLink())throw new Error('源码目录存在重解析路径。');
    const path=resolve(directory,item.name);
    if(item.isDirectory()){await check(path);continue;}
    if(!/\.(?:ts|mjs)$/.test(item.name))continue;
    files.push(path);
  }
}
for(const directory of ['src','scripts','tests'])await check(resolve(root,directory));
await build({entryPoints:files,outdir:resolve(root,'.browser-regression-runtime','entrypoint-check'),bundle:true,write:false,platform:'node',format:'esm',packages:'external',logLevel:'warning'});
console.log(JSON.stringify({files:files.length,syntax_verified:true,imports_verified:true}));
