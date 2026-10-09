import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const result=spawnSync(process.execPath,[resolve(root,'scripts/manual-acceptance.mjs'),'--fresh',...process.argv.slice(2)],{
  cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,VV_TEST_BROWSER:process.env.VV_TEST_BROWSER??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
