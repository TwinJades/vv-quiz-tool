import {readFile,realpath,lstat} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';

export async function ownedBrowserConnection(file){
  const root=resolve(import.meta.dirname,'..'),runtime=resolve(root,'.browser-regression-runtime');
  const connection=JSON.parse(await readFile(resolve(root,file),'utf8'));
  if(connection.scope!=='owned-isolated-course-materials')throw new Error('Browser connection has no owned course scope.');
  const profile=resolve(connection.profile),path=relative(runtime,profile);
  if(path.startsWith('..')||isAbsolute(path)||!path||(await realpath(profile)).toLowerCase()!==profile.toLowerCase()||(await lstat(profile)).isSymbolicLink())throw new Error('Browser profile is outside the owned runtime.');
  const port=Number((await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/,1)[0]);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Owned browser port is invalid.');
  const count=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains($env:VV_OWNED_BROWSER_PROFILE) -and $_.CommandLine.Contains('--remote-debugging-port') }).Count"],{env:{...process.env,VV_OWNED_BROWSER_PROFILE:profile},encoding:'utf8',windowsHide:true}).trim());
  if(count!==1)throw new Error('Owned browser process could not be uniquely verified.');
  return {...connection,profile,port};
}

export async function ownedExtensionIds(profile){
  const preferences=JSON.parse(await readFile(resolve(profile,'Default','Secure Preferences'),'utf8'));
  const entries=Object.entries(preferences.extensions?.settings??{}).filter(([,entry])=>entry.state===1);
  const root=resolve(import.meta.dirname,'..');
  const vv=entries.filter(([,entry])=>entry.path&&resolve(entry.path)===resolve(root,'dist'));
  const speed=entries.filter(([,entry])=>/Global\s*Speed/i.test(entry.manifest?.name??''));
  if(vv.length!==1||speed.length!==1)throw new Error('Owned profile must have one enabled VV extension and Global Speed.');
  return {vv:vv[0][0],speed:speed[0][0]};
}
