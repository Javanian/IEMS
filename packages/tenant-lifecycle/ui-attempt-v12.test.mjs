import test from 'node:test';import assert from 'node:assert/strict';import{createCommandAttempt}from'../../apps/web/src/features/portfolio/client.mjs';
const identity={user:{id:'actor'},scope:{tenantId:'tenant',plantId:'plant'}};
const store=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values};};
test('v12 retained UI attempts bind exact key/body/scope and survive remount uncertainty',async()=>{
 const storage=store(),command=createCommandAttempt('owned-test',{storage,keyFactory:()=> 'original-command'}),body={name:'Original'},requests=[];
 const lost=async(path,options)=>{requests.push({path,...options});throw Object.assign(new Error('lost response'),{status:0});};
 await assert.rejects(command.send(identity,'/api/crm/accounts',body,{requester:lost}));body.name='Changed by refresh';assert.equal(command.snapshot().pending,true);
 await assert.rejects(command.send(identity,'/api/crm/accounts',body,{requester:lost}));await assert.rejects(command.retry({...identity,scope:{...identity.scope,plantId:'other'}},{requester:lost}),{code:'COMMAND_SCOPE_CHANGED'});
 const result=await command.retry(identity,{requester:async(path,options)=>{assert.deepEqual(options.body,{name:'Original',commandKey:'original-command'});return{data:{_id:'saved',version:1}};}});assert.equal(result.data._id,'saved');assert.equal(storage.values.size,0);assert.equal(command.snapshot().pending,false);
 let release;const pending=new Promise(resolve=>release=resolve);const first=command.send(identity,'/api/crm/accounts',{name:'Second'},{requester:()=>pending});await assert.rejects(command.send(identity,'/api/crm/accounts',{name:'Duplicate'}));release({data:{_id:'second',version:1}});await first;
 await assert.rejects(command.send(identity,'/api/crm/accounts',{name:'Invalid success'},{requester:async()=>({data:{}})}),{code:'INVALID_MUTATION_RESPONSE'});const remounted=createCommandAttempt('owned-test',{storage});assert.equal(remounted.snapshot().reconcile,true);await assert.rejects(remounted.send(identity,'/api/crm/accounts',{name:'cannot start'}));
 await assert.rejects(command.retry(identity,{requester:async()=>{throw Object.assign(new Error('conflict'),{status:409});}}));assert.equal(command.snapshot().reconcile,true);await assert.rejects(command.retry(identity),{code:'COMMAND_RECONCILIATION_REQUIRED'});
});

