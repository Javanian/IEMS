import test from 'node:test';
import assert from 'node:assert/strict';
import { abandonCustodyCommand, adoptCustodyCommand, claimCustodyCommand, custodyCapability, custodyEventPath, custodyTransferReason, hasCustodyMarker, releaseSerialClaims } from '../src/features/portfolio/serial-custody.mjs';
import { planCommand, releaseCommand } from '../src/features/portfolio/manufacturing.mjs';
import { engineeringRelease } from '../src/features/portfolio/engineering.mjs';

test('incoming custody planning is explicit and omitted for unchanged prior flows', () => {
  const order = { _id:'so', version:1, snapshot:{ lines:[{ uom:'UN' }] } }, values = { lineIndex:'0', quantities:'2\n1', serialized:'true', genealogyRequired:'true' };
  const legacy = planCommand(order, values, 'same-key');
  assert.equal(Object.hasOwn(legacy, 'serialCustodyRequired'), false);
  assert.deepEqual(planCommand(order, { ...values, serialCustodyRequired:'false' }, 'same-key'), legacy);
  assert.equal(planCommand(order, { ...values, serialCustodyRequired:'true' }, 'required-key').serialCustodyRequired, true);
});

test('adoption captures receipt authority only and does not convert registry identifiers to availability', () => {
  const source = { receiptVersion:7 }, command = adoptCustodyCommand(source, { reason:'Untouched incoming stock', serials:['REGISTRY-ONLY'], tracked:true }, 'adopt-key');
  source.receiptVersion = 9;
  assert.deepEqual(command, { expectedVersion:7, reason:'Untouched incoming stock', idempotencyKey:'adopt-key' });
  assert.equal(custodyTransferReason({ tracked:false, mode:'UNTRACKED' }).includes('invalid or unavailable'), true);
});

test('claims capture UUID selections and both real versions, ignoring quantity and trace overrides', () => {
  const wo = { workOrderVersion:3 }, receipt = { receiptVersion:4, receiptId:'receipt' }, values = { serialUnitIds:['unit-a', 'unit-b'], reason:'Exact incoming identities', quantity:'999', receiptId:'forged', materialTrace:{ lotNumber:'forged' } };
  const command = claimCustodyCommand(wo, receipt, values, 'claim-key'); values.serialUnitIds.pop(); wo.workOrderVersion = 8; receipt.receiptVersion = 10;
  assert.deepEqual(command, { expectedVersion:3, expectedReceiptVersion:4, receiptId:'receipt', serialUnitIds:['unit-a', 'unit-b'], reason:'Exact incoming identities', idempotencyKey:'claim-key' });
});

test('abandon binds the selected claim ID in the command body and uses its captured version', () => {
  const wo = { workOrderVersion:6, claims:[{ _id:'claim-a', version:2 }, { _id:'claim-b', version:9 }] };
  assert.deepEqual(abandonCustodyCommand(wo, { claimId:'claim-a', reason:'Abandon unused planned source', expectedClaimVersion:99 }, 'abandon-key'), { expectedVersion:6, expectedClaimVersion:2, claimId:'claim-a', reason:'Abandon unused planned source', idempotencyKey:'abandon-key' });
});

test('both release paths preserve the complete CLAIMED source mapping and legacy payload omission', () => {
  const claims = [{ _id:'claim-a', receiptId:'receipt-a', status:'CLAIMED' }, { _id:'claim-b', receiptId:'receipt-b', status:'CLAIMED' }, { _id:'old', receiptId:'old-receipt', status:'ABANDONED' }], wo = { version:7, serialCustodyRequired:true };
  const values = { code0:'ASSEMBLE', instruction0:'Explicit claim-bound operation', receiptId0:'receipt-a', quantityPerUnit0:'2.0000', materialUom0:'SET' };
  const mapping = { serialClaims:[{ receiptId:'receipt-a', claimId:'claim-a' }, { receiptId:'receipt-b', claimId:'claim-b' }] };
  assert.deepEqual(releaseSerialClaims(wo, claims), mapping);
  assert.deepEqual(releaseCommand(wo, values, 1, 1, 'manual-key', claims).serialClaims, mapping.serialClaims);
  assert.equal(releaseCommand(wo, values, 1, 1, 'manual-key', claims).materials[0].quantityPerUnit, '2.0000');
  assert.deepEqual(engineeringRelease(wo, { _id:'package', version:3, currentRevision:2 }, 'engineering-key', claims).serialClaims, mapping.serialClaims);
  assert.equal(Object.hasOwn(releaseCommand({ version:7 }, values, 1, 1, 'legacy-key', claims), 'serialClaims'), false);
  assert.equal(Object.hasOwn(engineeringRelease({ version:7 }, { _id:'package', version:3, currentRevision:2 }, 'legacy-key', claims), 'serialClaims'), false);
});

test('any present custody marker, including null or malformed, remains distinguishable from legacy stock', () => {
  assert.equal(hasCustodyMarker({}), false);
  for (const marker of [null, undefined, false, {}, { mode:'UNKNOWN' }, { mode:'RECEIVED_V1' }]) assert.equal(hasCustodyMarker({ serialCustody:marker }), true);
});

test('whole-receipt transfer fails closed without current authority and with any unavailable identity or hold', () => {
  const source = { tracked:true, mode:'RECEIVED_V1', quantity:'2.000000', quantityAvailable:'2', sourceHolds:[], units:[{ status:'AVAILABLE' }, { status:'AVAILABLE' }] };
  assert.equal(custodyTransferReason(source), '');
  assert.match(custodyTransferReason(undefined), /Read current/);
  assert.match(custodyTransferReason({ ...source, tracked:false, mode:'UNTRACKED' }), /invalid or unavailable/);
  assert.match(custodyTransferReason({ ...source, units:[{ status:'AVAILABLE' }, { status:'CLAIMED' }] }), /every custody identity AVAILABLE/);
  assert.match(custodyTransferReason({ ...source, quantityAvailable:'1' }), /unencumbered/);
  assert.match(custodyTransferReason({ ...source, sourceHolds:[{ receiptId:'receipt' }] }), /source holds/);
  assert.match(custodyTransferReason({ ...source, units:[] }), /every custody identity/);
});

test('dedicated custody grants do not follow existing warehouse or manufacturing permissions', () => {
  for (const action of ['custody.read', 'custody.adopt', 'custody.claim', 'custody.abandon']) assert.equal(custodyCapability(action, ['warehouse.read', 'manufacturing.read', 'manufacturing.release']).enabled, false);
  assert.equal(custodyCapability('custody.claim', undefined).enabled, false);
  assert.equal(custodyCapability('custody.claim', ['custody.read']).enabled, false);
  assert.equal(custodyCapability('custody.abandon', ['custody.read', 'custody.abandon']).enabled, true);
});

test('custody event pagination remains separately scoped to the selected resource', () => {
  assert.equal(custodyEventPath('/api/manufacturing/work-orders/wo/serial-claims', 'cursor&x=1'), '/api/manufacturing/work-orders/wo/serial-claims/events?limit=25&cursor=cursor%26x%3D1');
});
