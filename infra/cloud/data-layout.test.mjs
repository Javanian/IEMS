import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dataLayout,parity } from './data-layout.mjs';
test('cloud layout binds tenant prefix, topic and payload digest; parity rejects drift',()=>{
  const tenantId=randomUUID(),plantId=randomUUID(),a={tenantId,plantId,eventId:randomUUID(),payload:{tenantId,plantId,quantity:'9007199254740993.000001',uom:'EA'}};
  const p=dataLayout(a);assert.ok(p.s3.key.startsWith(`tenants/${tenantId}/`));assert.equal(p.msk.securityProtocol,'SASL_SSL');
  assert.equal(parity([a],[structuredClone(a)]).state,'MATCH');const b=structuredClone(a);b.payload.quantity='0';assert.equal(parity([a],[b]).state,'MISMATCH');
  b.payload.tenantId=randomUUID();assert.throws(()=>dataLayout(b));assert.throws(()=>parity([a,a],[a]));
});
