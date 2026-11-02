import assert from 'node:assert/strict';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,join,relative} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {nativeN8nWorkflowHash} from '../../packages/tenant-lifecycle/native-n8n-provider.mjs';

const historyPath=root=>join(root,'n8n-user','.n8n','database.sqlite');
export function assertFreshNativeDatabase(root){
  assert.equal(existsSync(historyPath(root)),false,'NATIVE_SETUP_REQUIRES_FRESH_DATABASE');
}

export function verifyNativeActivationRows(workflows,rows,phase){
  assert.ok(['imported','all','final'].includes(phase));
  assert.equal(workflows.length,8,'NATIVE_WORKFLOW_INVENTORY');
  assert.equal(new Set(workflows.map(w=>w.id)).size,8,'NATIVE_WORKFLOW_INVENTORY');
  assert.ok(workflows.some(w=>w.id==='wf-automation-error'),'NATIVE_ERROR_WORKFLOW_REQUIRED');
  assert.deepEqual(rows.map(w=>w.id).sort(),workflows.map(w=>w.id).sort(),'NATIVE_WORKFLOW_INVENTORY');
  for(const expected of workflows){
    const row=rows.find(w=>w.id===expected.id);
    assert.equal(nativeN8nWorkflowHash(row),nativeN8nWorkflowHash(expected),'NATIVE_WORKFLOW_REVISION');
    const active=phase==='all'||phase==='final'&&row.id!=='wf-automation-error';
    assert.equal(row.active,Number(active),'NATIVE_WORKFLOW_ACTIVE_STATE');
  }
}

export async function activateNativeWorkflows({root,config,db,workflows,cli,assertStopped}){
  const owner={schema:'IEMS_NATIVE_N8N_OWNER_V1',marker:config.marker,instanceId:config.instanceId,databaseName:config.database,n8nVersion:'1.121.3',evidenceClass:'NATIVE_RUNTIME'};
  const inspect=async phase=>{
    assert.equal(config.native,true,'NATIVE_ACTIVATION_ONLY');
    assertStopped();
    assert.deepEqual(JSON.parse(readFileSync(join(root,'native-owner.json'),'utf8')),owner,'NATIVE_ACTIVATION_OWNER');
    assert.equal(db.databaseName,config.database,'NATIVE_ACTIVATION_DATABASE');
    assert.ok(/^portfolio_owned_native_[a-f0-9]{32}$/.test(config.database),'NATIVE_ACTIVATION_DATABASE');
    assert.equal(config.database,'portfolio_owned_native_'+config.marker.replaceAll('-',''),'NATIVE_ACTIVATION_DATABASE');
    assert.ok(await db.collection('ownedRun').findOne({_id:config.marker}),'NATIVE_ACTIVATION_OWNER');
    assertStopped();
    const path=realpathSync(historyPath(root)),within=relative(realpathSync(root),path);
    assert.ok(within&&!within.startsWith('..')&&!isAbsolute(within),'NATIVE_ACTIVATION_PATH');
    const sqlite=new DatabaseSync(path,{readOnly:true});
    try{
      sqlite.exec('PRAGMA query_only=ON; BEGIN');
      assert.equal(sqlite.prepare('SELECT count(*) AS count FROM execution_entity').get().count,0,'NATIVE_SETUP_EXECUTIONS_PRESENT');
      const rows=sqlite.prepare('SELECT id,name,nodes,connections,settings,pinData,staticData,active FROM workflow_entity ORDER BY id').all().map(row=>({...row,nodes:JSON.parse(row.nodes),connections:JSON.parse(row.connections),settings:JSON.parse(row.settings??'{}'),pinData:JSON.parse(row.pinData??'null'),staticData:JSON.parse(row.staticData??'null')}));
      verifyNativeActivationRows(workflows,rows,phase);
      return rows.map(({id,active})=>({id,active}));
    }finally{sqlite.close();}
  };
  await inspect('imported');
  await cli('activate-native-all',['update:workflow','--all','--active=true']);
  await inspect('all');
  await cli('deactivate-native-error',['update:workflow','--id=wf-automation-error','--active=false']);
  return {marker:config.marker,verifiedAt:new Date().toISOString(),workflows:await inspect('final')};
}
