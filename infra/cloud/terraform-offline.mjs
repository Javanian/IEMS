import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const scratch=process.env.PAPERCLIP_RUN_SCRATCH_DIR||process.env.PAPERCLIP_SCRATCH_DIR;
if(!scratch)throw new Error('Run-owned scratch directory required');
const root=fileURLToPath(new URL('../terraform/pilot/',import.meta.url));
const target=join(resolve(scratch),`pilot-terraform-${Date.now()}`);mkdirSync(target,{recursive:true});cpSync(root,target,{recursive:true});
const env={...process.env,TF_INPUT:'0',TF_IN_AUTOMATION:'1',CHECKPOINT_DISABLE:'1',AWS_EC2_METADATA_DISABLED:'true',AWS_ACCESS_KEY_ID:'offline-mock-only',AWS_SECRET_ACCESS_KEY:'offline-mock-only'};
for(const k of Object.keys(env))if(k.startsWith('TF_CLI_ARGS')||k.startsWith('TF_VAR_')||k.startsWith('MONGODB_ATLAS_')||['AWS_PROFILE','AWS_SESSION_TOKEN','AWS_WEB_IDENTITY_TOKEN_FILE','AWS_ROLE_ARN'].includes(k))delete env[k];
env.TF_WORKSPACE='default';env.TF_CLI_CONFIG_FILE=join(target,'offline.tfrc');
const mirror=process.env.PLATFORM_TF_PROVIDER_MIRROR;
writeFileSync(env.TF_CLI_CONFIG_FILE,`disable_checkpoint = true\nprovider_installation {\n filesystem_mirror {\n path = ${JSON.stringify(resolve(mirror||target).replaceAll('\\','/'))}\n include = ["registry.terraform.io/hashicorp/aws", "registry.terraform.io/mongodb/mongodbatlas"]\n }\n}\n`);
const result={schema:'CLOUD_OFFLINE_CHECK_V1',status:'NOT_RUN',checks:[]};
const run=(args,cwd)=>{
  env.TF_DATA_DIR=join(cwd,'.terraform');
  const p=spawnSync('terraform',args,{cwd,env,encoding:'utf8',timeout:120000,windowsHide:true});
  result.checks.push({command:['terraform',...args],cwd,exit:p.status,error:p.error?.code,stdout:p.stdout,stderr:p.stderr});return !p.error&&p.status===0;
};
if(!run(['version','-json'],target))result.reason='Terraform unavailable or version command failed';
else if(!run(['fmt','-check','-recursive'],target))result.status='FAIL';
else if(!mirror||!existsSync(mirror))result.reason='Installed offline provider mirror required';
else {
  result.status='PASS';
  for(const cwd of [target,join(target,'atlas')]) {
    if(!run(['init','-backend=false','-input=false'],cwd)||!run(['validate','-no-color'],cwd)||!run(['test','-no-color'],cwd)){result.status='FAIL';break;}
  }
}
const evidence=join(resolve(scratch),'pilot-terraform-result.json');writeFileSync(evidence,JSON.stringify(result,null,2));
console.log(JSON.stringify({status:result.status,reason:result.reason,evidence}));process.exitCode=result.status==='PASS'?0:result.status==='NOT_RUN'?2:1;
