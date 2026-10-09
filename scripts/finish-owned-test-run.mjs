import {spawn} from 'node:child_process';
import {writeFile,realpath,lstat} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';

const root=resolve(import.meta.dirname,'..');
async function waitForExit(child){
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise((resolveExit,reject)=>{
    const finish=()=>{clearTimeout(timer);child.removeListener('exit',finish);resolveExit();};
    const timer=setTimeout(()=>{child.removeListener('exit',finish);reject(new Error('自有测试浏览器尚未退出，保留运行资料。'));},15000);
    child.once('exit',finish);
    if(child.exitCode!==null||child.signalCode!==null)finish();
  });
}
async function cleanup(run,apply){
  return new Promise((resolveCleanup,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve(root,'scripts/Clear-VV-TestRuntime.ps1'),'-RunDirectory',run,...(apply?['-Apply']:[])],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{errors+=data;});
    child.once('error',reject);child.once('exit',code=>{if(code!==0)reject(new Error('测试资料回收失败：'+errors.trim()));else resolveCleanup(output.trim());});
  });
}
export async function finishOwnedTestRun(directory,browsers){
  const run=resolve(directory),runtime=await realpath(resolve(root,'.browser-regression-runtime'));
  if(dirname(run)!==runtime||!/^(background|provider-mv3)-/.test(relative(runtime,run)))throw new Error('测试资料回收目录身份无效。');
  for(let path=run;path!==dirname(root);path=dirname(path))if((await lstat(path)).isSymbolicLink())throw new Error('拒绝回收重解析路径。');
  await Promise.all(browsers.map(waitForExit));
  const preview=await cleanup(run,false);
  const applied=await cleanup(run,true);
  await writeFile(resolve(run,'runtime-cleanup.json'),JSON.stringify({finished_at:new Date().toISOString(),preview,applied},null,2),{flag:'wx'});
}
