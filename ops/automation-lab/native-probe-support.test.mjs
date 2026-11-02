import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {stopNativeSupervisor,nativeOwnerPassword} from './native-probe-support.mjs';

test('native owner fixture meets the installed pinned n8n password schema without reducing entropy',()=>{
  const packageRoot=process.env.IEMS_N8N_PACKAGE_ROOT??'D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime/node_modules/n8n';
  const require=createRequire(join(packageRoot,'package.json'));
  assert.equal(require('./package.json').version,'1.121.3');
  const {passwordSchema}=require('../@n8n/api-types/dist/schemas/password.schema.js');
  assert.equal(passwordSchema.safeParse('Iems-'+'a'.repeat(64)+'9a').success,false);
  for(let i=0;i<3;i++){
    const password=nativeOwnerPassword();
    assert.equal(password.length,50);
    assert.equal(Buffer.from(password.slice(5,-2),'base64url').length,32);
    assert.equal(passwordSchema.safeParse(password).success,true);
  }
});

test('self-failed supervisor exit is awaited without requesting an impossible control ACK',async t=>{
  const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(1),200)'],{windowsHide:true,stdio:'ignore'});let requests=0;
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
  await stopNativeSupervisor({child,state:()=>({phase:'failed'}),requestStop:()=>{requests++;throw Error('Control loop is gone');}});
  assert.equal(requests,0);assert.equal(child.exitCode,1);
});

test('running owned supervisor still requires its normal stop request and actual exit',async t=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});let requests=0;
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
  await stopNativeSupervisor({child,state:()=>({phase:'ready'}),requestStop:async()=>{requests++;child.kill('SIGTERM');}});
  assert.equal(requests,1);assert.ok(child.exitCode!==null||child.signalCode!==null);
});
