import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {nativeN8nWorkflowHash} from '../../packages/tenant-lifecycle/native-n8n-provider.mjs';

export function materializeNativeNodeDefaults(workflows,packageRoot=process.env.IEMS_N8N_PACKAGE_ROOT??'D:/IEMS-Automation-Lab/TPR-157-e4efd721-native/runtime/node_modules/n8n'){
  const require=createRequire(join(packageRoot,'package.json'));
  if(require('./package.json').version!=='1.121.3')throw Error('NATIVE_PINNED_NODE_SCHEMAS_REQUIRED');
  const schemas=require('../n8n-nodes-base/dist/types/nodes.json'),{NodeHelpers}=require('n8n-workflow');
  const versions={scheduleTrigger:1.2,httpRequest:4.2,if:2.2,splitOut:1,set:3.4,webhook:2,code:2,errorTrigger:1};
  for(const workflow of workflows)for(const node of workflow.nodes){
    const name=node.type.slice('n8n-nodes-base.'.length);
    if(node.type!==`n8n-nodes-base.${name}`||versions[name]!==node.typeVersion)throw Error('NATIVE_NODE_SCHEMA_UNSUPPORTED');
    const matches=schemas.filter(schema=>schema.name===name&&[].concat(schema.version).includes(node.typeVersion));
    if(matches.length!==1)throw Error('NATIVE_NODE_SCHEMA_AMBIGUOUS');
    // Freeze the same defaults n8n adds before execution, before binding the workflow revision.
    node.parameters=NodeHelpers.getNodeParameters(matches[0].properties,node.parameters,true,false,node,matches[0])??{};
  }
  return workflows;
}

export function nativeWorkflowRevisions({apiPort,smtpPort,webPort,n8nPackageRoot}) {
  if(![apiPort,smtpPort,webPort].every(port=>Number.isInteger(port)&&port>=32740&&port<=32759))throw Error('NATIVE_OWNED_PORT_REQUIRED');
  const result=[];
  for(const id of ['wf-sla-escalation','wf-cs-weekly-digest','wf-approved-resolution','wf-automation-recovery','wf-automation-error']){
    const template=JSON.parse(readFileSync(new URL(`./workflows/${id}.json`,import.meta.url),'utf8').replaceAll('http://127.0.0.1:4319',`http://127.0.0.1:${apiPort}`).replaceAll('http://127.0.0.1:5187',`http://127.0.0.1:${webPort}`).replaceAll('smtpPort:2527',`smtpPort:${smtpPort}`));
    const schedules=template.nodes.filter(node=>node.type==='n8n-nodes-base.scheduleTrigger');
    if(schedules.length){
      // ScheduleTrigger owns mutable recurrenceRules. Keep it outside the immutable webhook revision.
      const scheduled=structuredClone(template);scheduled.id=id+'-schedule';scheduled.name+=' (schedule)';
      const removed=new Set(['Operator trigger','IEMS_NATIVE_INPUT','Native mail delivery','Original operation input','Native SMTP DATA','IEMS_NATIVE_RESULT']);
      scheduled.nodes=scheduled.nodes.filter(node=>!removed.has(node.name));
      for(const name of [...removed,'Execution reference'])delete scheduled.connections[name];
      result.push(scheduled);
    }
    template.nodes=template.nodes.filter(node=>node.type!=='n8n-nodes-base.scheduleTrigger');
    for(const node of schedules)delete template.connections[node.name];
    result.push(template);
  }
  return materializeNativeNodeDefaults(result,n8nPackageRoot);
}

export function nativeWorkflowBindings(workflows,n8nPort){
  if(!Number.isInteger(n8nPort)||n8nPort<32740||n8nPort>32759)throw Error('NATIVE_OWNED_PORT_REQUIRED');
  return workflows.filter(workflow=>workflow.nodes.some(node=>node.name==='IEMS_NATIVE_INPUT')).map(workflow=>({workflowId:workflow.id,workflowHash:nativeN8nWorkflowHash(workflow),inputNode:'IEMS_NATIVE_INPUT',resultNode:'IEMS_NATIVE_RESULT',webhookUrl:`http://127.0.0.1:${n8nPort}/webhook/${workflow.nodes.find(node=>node.type==='n8n-nodes-base.webhook').parameters.path}`}));
}
