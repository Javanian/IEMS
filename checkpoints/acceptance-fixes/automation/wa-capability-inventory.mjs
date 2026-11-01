import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const original='D:/Project AI/GITHUB/IEMS-worktrees/iems-all-20261030-final_qa/checkpoints/iems-all-features/qa/WA-VERDICTS.json';
const authorities={
  policy:['apps/wa-demo-bridge/src/provider-policy.mjs','apps/wa-demo-bridge/test/provider-policy.test.mjs'],
  source:['apps/wa-demo-bridge/src/provider-binding-source.mjs','apps/portfolio-api/test/order-reader.test.mjs'],
  commands:['apps/wa-demo-bridge/src/provider-commands.mjs','apps/wa-demo-bridge/test/provider-commands.test.mjs'],
  lifecycle:['apps/wa-demo-bridge/src/provider-lifecycle.mjs','apps/wa-demo-bridge/src/local-browser-driver.mjs','apps/wa-demo-bridge/test/local-browser-driver.test.mjs'],
  callback:['apps/wa-demo-bridge/src/provider-reconciliation.mjs','apps/wa-demo-bridge/test/provider-reconciliation.test.mjs'],
  operator:['apps/wa-demo-bridge/src/provider-operator.mjs','apps/wa-demo-bridge/test/provider-operator-http.test.mjs'],
  core:['packages/customer-service/service-operations.test.mjs','apps/wa-demo-bridge/test/customer-service.test.mjs'],
  native:['ops/automation-lab/lab-runtime.mjs','ops/automation-lab/workflows/wf-automation-recovery.json'],
};
const mapping=['policy','policy','source','source','source','commands','commands','operator','callback','callback','lifecycle','policy','core','operator','core','operator','core','source','native','core'];
const hashes=Object.fromEntries([...new Set(Object.values(authorities).flat())].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const items=JSON.parse(readFileSync(original)); assert.equal(items.length,20);
const rows=items.map((old,i)=>({id:old.id,requirement:old.requirement,historical:{source:old.sourceHead,verdict:old.verdict,limitation:old.limitation,evidence:old.evidence},currentSourcePaths:authorities[mapping[i]],currentExecution:'NOT_RUN_ON_CORRECTIVE_COMPOSITION',controlledProviderAcceptance:'NOT_RUN',capability:i===10?'Owned about:blank Chrome driver only; no inbound/ready/send interface.':i===14?'Synthetic privacy/retention policy needs actual reset/export/log tests; no real private history authorized.':i===16?'Prior benchmark is historical local synthetic; inbound/UI/provider latency still needs separate measurement.':i===18?'Actual pinned n8n cold setup is being measured; historical/inflight graph is not replaced by controlled effects.':'Local contract implementation/test files exist; discovery is not an execution receipt.',nextOwner:'CTO assigns independent acceptance after corrected freeze; original automation owner supplies remaining bounded native probes.'}));
const result={sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),originalInventoryHash:createHash('sha256').update(readFileSync(original)).digest('hex'),sourceHashes:hashes,featureIds:['PLAT-051','PLAT-052','PLAT-053','PLAT-054'],privacyBoundary:'No personal account/provider send authorized. Blank-browser driver and synthetic callbacks are not live-provider evidence. Local missing probes remain NOT_RUN, not EXTERNAL_DEPENDENCY.',rows};
writeFileSync(new URL('./WA-CAPABILITY-INVENTORY.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log('20 original requirements preserved;18 core WA rows plus2 supplemental; no new acceptance verdict.');
