import { contentHash } from '../../packages/tenant-foundation/commands.mjs';
import { parity } from './data-layout.mjs';
import { uuid } from '../../ops/pilot/rehearsal.mjs';

export function evaluationManifest({tenantId,plantId,sourceManifestHash,catalog,schema,table}) {
  if(![tenantId,plantId].every(uuid)||!(/^[a-f0-9]{64}$/.test(sourceManifestHash))||
    ![catalog,schema,table].every(x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(x)))throw new Error('Invalid portability evaluation scope or immutable source hash');
  return {schema:'DATABRICKS_EVALUATION_V1',status:'PLANNED',tenantId,plantId,sourceManifestHash,
    target:{catalog,schema,table},submitEnabled:false,budgetApproval:'NOT_RECORDED',
    requiredEvidence:['approved_budget','authorized_dataset','tenant_isolation_negative_case','actual_job_run_receipt','runtime_version','source_and_target_hashes','measured_cost','rollback_cleanup_owner']};
}
export function evaluateExport(manifest,source,target) {
  const validated=evaluationManifest({...manifest,schema:manifest.target?.schema,catalog:manifest.target?.catalog,table:manifest.target?.table});
  if([...source,...target].some(row=>row.tenantId!==manifest.tenantId||row.plantId!==manifest.plantId))throw new Error('Cross-scope evaluation');
  const result=parity(source,target);
  return {schema:'DATABRICKS_LOCAL_COMPARISON_V1',status:'PLANNED',evidenceClass:'LOCAL_SYNTHETIC',manifestHash:contentHash(validated),
    comparison:result,actualJob:'NOT_RUN',actualCost:'NOT_MEASURED',cloudAcceptance:'EXTERNAL_DEPENDENCY'};
}
