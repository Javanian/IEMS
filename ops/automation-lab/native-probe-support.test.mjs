import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {stopNativeSupervisor} from './native-probe-support.mjs';

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
