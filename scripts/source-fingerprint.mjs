import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';

export async function sourceFingerprint(root){
  const hash=createHash('sha256');
  const file=async path=>{const data=await readFile(path);hash.update(JSON.stringify([relative(root,path).replaceAll('\\','/'),data.length]));hash.update(data);};
  const directory=async path=>{
    const entries=(await readdir(path,{withFileTypes:true})).sort((left,right)=>left.name.localeCompare(right.name));
    for(const entry of entries){if(entry.isSymbolicLink())throw new Error('源码构建指纹拒绝重解析路径。');const item=resolve(path,entry.name);if(entry.isDirectory())await directory(item);else if(entry.isFile())await file(item);else throw new Error('源码目录存在未知文件类型。');}
  };
  for(const name of ['package.json','pnpm-lock.yaml','scripts/build.mjs','scripts/generate-icons.mjs','scripts/source-fingerprint.mjs'])await file(resolve(root,name));
  await directory(resolve(root,'src'));await directory(resolve(root,'static'));
  return hash.digest('hex');
}
