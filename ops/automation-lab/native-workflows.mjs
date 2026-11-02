import {readFileSync} from 'node:fs';
import {nativeN8nWorkflowHash} from '../../packages/tenant-lifecycle/native-n8n-provider.mjs';

export function nativeWorkflowRevisions({apiPort,smtpPort,webPort}) {
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
  return result;
}

export function nativeWorkflowBindings(workflows,n8nPort){
  if(!Number.isInteger(n8nPort)||n8nPort<32740||n8nPort>32759)throw Error('NATIVE_OWNED_PORT_REQUIRED');
  return workflows.filter(workflow=>workflow.nodes.some(node=>node.name==='IEMS_NATIVE_INPUT')).map(workflow=>({workflowId:workflow.id,workflowHash:nativeN8nWorkflowHash(workflow),inputNode:'IEMS_NATIVE_INPUT',resultNode:'IEMS_NATIVE_RESULT',webhookUrl:`http://127.0.0.1:${n8nPort}/webhook/${workflow.nodes.find(node=>node.type==='n8n-nodes-base.webhook').parameters.path}`}));
}
