import test from 'node:test';
import assert from 'node:assert/strict';
import { freshness, quantityBuckets, legacySnapshot, invoiceBalance, createLegacyReadAdapters } from '../../apps/portfolio-api/src/operations.mjs';

test('quantity buckets retain exact decimals and units; missing fields remain incomplete', () => {
  const result = quantityBuckets([{ quantity: '9007199254740993.1', uom: 'EA' }, { quantity: '0.9', uom: 'EA' }, { quantity: '2.25', uom: 'KG' }, { uom: 'KG' }], r => [r]);
  assert.equal(result.status, 'INCOMPLETE');
  assert.deepEqual(result.buckets, [{ uom: 'EA', quantity: '9007199254740994.000000000000' }, { uom: 'KG', quantity: '2.250000000000' }]);
  assert.equal(quantityBuckets([], r => [r]).status, 'NO_DATA');
});
test('freshness never reports absent or future timestamps as current', () => {
  const now = new Date('2026-10-31T00:00:00.000Z');
  assert.equal(freshness(null, now).status, 'NO_DATA');
  assert.equal(freshness('2026-10-31T00:01:00.000Z', now).status, 'INCOMPLETE');
  assert.equal(freshness('2026-10-30T23:00:00.000Z', now).status, 'STALE');
});
test('order financial balance is separate, exact and never invented from absent invoice rows', () => {
  const order = { id:'order',currency:'USD',orderAmount:'9007199254740994.20' };
  assert.equal(invoiceBalance(order,[]).paidAmount,null);
  const invoice = { currency:'USD',proofMode:'IMMUTABLE_POSTING_V1',total:'9007199254740993.10',paidAmount:'0.10',creditedAmount:'0.00',outstandingAmount:'9007199254740993.00' };
  const result = invoiceBalance(order,[invoice,{...invoice,total:'1.10',outstandingAmount:'1.00'}]);
  assert.equal(result.orderAmount,order.orderAmount);assert.equal(result.invoicedAmount,'9007199254740994.20');assert.equal(result.outstandingAmount,'9007199254740994.00');
  assert.equal(invoiceBalance(order,[{...invoice,creditedAmount:undefined}]).creditedAmount,null);
  assert.equal(invoiceBalance(order,[{...invoice,currency:'IDR'}]).outstandingAmount,null);
});
test('legacy adapters require scoped authorization and strip private fields', async () => {
  const sample = { resourceId: '11111111-1111-4111-8111-111111111111', sourceRevision: '3', value: '2', uom: 'MIN', sampleAt: '2026-10-30T23:00:00.000Z', windowFrom: '2026-10-30T22:00:00.000Z', windowUntil: '2026-10-30T23:00:00.000Z', biometricTemplate: 'must-not-leak' };
  let authorized = false;
  const result = await legacySnapshot({ kind: 'TIMESHEET', authorize: async () => { authorized = true; }, read: async () => { assert(authorized); return { observedAt: '2026-10-30T23:00:00.000Z', completeness: 'COMPLETE', samples: [sample] }; } }, { filter: {}, now: new Date('2026-10-31T00:00:00.000Z') });
  assert.equal(result.samples[0].biometricTemplate, undefined);
  assert.equal((await legacySnapshot(null, {})).status, 'NO_DATA');
  await assert.rejects(legacySnapshot({ kind: 'NFC', authorize: async () => {}, read: async () => ({ observedAt: '2026-10-30T23:00:00.000Z', completeness: 'COMPLETE', samples: [{ ...sample, uom: 'private value' }] }) }, { filter: {}, now: new Date('2026-10-31T00:00:00.000Z') }), /LEGACY_SAMPLE_INVALID/);
});
test('five legacy adapters bind source keys, read only, and preserve signed SPC units', async () => {
  const observedAt='2026-10-31T00:00:00.000Z',calls=[],key='machine; DELETE FROM usernfc',resourceId='11111111-1111-4111-8111-111111111111';let authorized=false;
  const pool={connect:async()=>({query:async(sql,values)=>{assert(authorized);calls.push({sql,values});if(sql.includes('transaction_timestamp'))return{rows:[{observed_at:observedAt}]};if(sql.startsWith('SELECT'))return{rows:[{value:sql.includes('pci.value')?'-1.25':'3',sample_at:observedAt,uom:'°C'}]};return{rows:[]};},release:()=>{}})};
  const adapters=createLegacyReadAdapters({pool,authorize:async()=>{authorized=true;},resolveBindings:async()=>[{resourceId,sourceKey:key,parameterId:1,sourceUom:'°C',uom:'DEG_C'}]});
  for(const adapter of adapters){authorized=false;const r=await legacySnapshot(adapter,{filter:{},scope:{},now:new Date(observedAt)});assert.equal(r.samples.length,1);if(adapter.kind==='SPC'){assert.equal(r.samples[0].value,'-1.25');assert.equal(r.samples[0].uom,'DEG_C');}}
  assert.equal(calls.filter(c=>c.sql==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY').length,5);
  assert(calls.every(c=>!c.sql.includes(key)));assert(calls.some(c=>c.values?.includes(key)));
  assert(calls.every(c=>!/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(c.sql)));
});
