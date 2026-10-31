import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evaluationManifest,evaluateExport } from './databricks-evaluation.mjs';
test('optional Databricks evaluation remains planned even when local parity matches',()=>{
  const tenantId=randomUUID(),plantId=randomUUID();
  const m=evaluationManifest({tenantId,plantId,sourceManifestHash:'a'.repeat(64),catalog:'pilot',schema:'tenant',table:'snapshots'});
  const row={tenantId,plantId,eventId:randomUUID(),payload:{tenantId,plantId,amount:'123.45',currency:'USD'}};
  const r=evaluateExport(m,[row],[structuredClone(row)]);assert.equal(r.status,'PLANNED');assert.equal(r.comparison.state,'MATCH');assert.equal(m.submitEnabled,false);
  const foreign={...row,tenantId:randomUUID()};assert.throws(()=>evaluateExport(m,[row],[foreign]));
});
