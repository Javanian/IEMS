import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/features/portfolio/manufacturing.mjs';
import { finalizeInstallationCommand, installationCapability, installationHint, installationLossCommand, installationPage, installationPath, recordInstallationCommand, removeInstallationCommand } from '../src/features/portfolio/installation.mjs';

const view = () => ({ workOrderVersion:11, version:2, graphVersion:8, components:[{ _id:'received-a', version:7, status:'CONSUMED', disposition:null }, { _id:'received-b', version:9, status:'CONSUMED', disposition:null }], edges:[{ _id:'edge-a', version:3, childId:'received-a', outputUnitId:'parent-a', status:'ACTIVE' }] });

test('installation opt-in preserves every previous cohort when omitted or false', () => {
  const order = { _id:'so', version:1, snapshot:{ lines:[{ uom:'UN' }] } }, values = { lineIndex:'0', quantities:'2\n1', serialized:'true', genealogyRequired:'true', serialCustodyRequired:'true' };
  const legacy = planCommand(order, values, 'same-key');
  assert.equal(Object.hasOwn(legacy, 'installationRequired'), false);
  assert.deepEqual(planCommand(order, { ...values, installationRequired:'false' }, 'same-key'), legacy);
  assert.deepEqual(planCommand(order, { ...values, installationRequired:'true' }, 'new-key'), { ...legacy, installationRequired:true, idempotencyKey:'new-key' });
});

test('record captures explicit parent and received UUID versions without accepting source authority overrides', () => {
  const state = view(), values = { outputUnitId:'parent-a', serialUnitIds:['received-b', 'received-a'], reason:'Observed received installation', expectedUnitVersion:999, childType:'MANUFACTURED', materialTrace:{ lotNumber:'forged' }, contentHash:'forged', quantity:'100' };
  const command = recordInstallationCommand(state, values, 'record-key');
  values.serialUnitIds.pop(); state.workOrderVersion = 30; state.version = 20; state.components[0].version = 99;
  assert.deepEqual(command, { expectedVersion:11, expectedInstallationVersion:2, reason:'Observed received installation', idempotencyKey:'record-key', outputUnitId:'parent-a', components:[{ serialUnitId:'received-b', expectedUnitVersion:9 }, { serialUnitId:'received-a', expectedUnitVersion:7 }] });
});

test('record never expands an omitted selection into automatic equal installation', () => {
  assert.deepEqual(recordInstallationCommand(view(), { outputUnitId:'parent-a', reason:'No implicit identity selection' }, 'empty-key').components, []);
});

test('explicit process loss captures received unit fences and omits parent/replacement fields', () => {
  assert.deepEqual(installationLossCommand(view(), { lossSerialUnitIds:['received-a'], reason:'Exact consumed source lost in process', outputUnitId:'forged-parent', replacementUnitId:'forged-spare' }, 'loss-key'), { expectedVersion:11, expectedInstallationVersion:2, reason:'Exact consumed source lost in process', idempotencyKey:'loss-key', components:[{ serialUnitId:'received-a', expectedUnitVersion:7 }] });
});

test('permanent removal binds actual edge and live received-unit versions without restock authority', () => {
  const state = view(), command = removeInstallationCommand(state, { edgeId:'edge-a', expectedEdgeVersion:999, expectedUnitVersion:999, reason:'Remove to permanent quarantine', replacementUnitId:'forged-replacement', returnToStock:true }, 'remove-key');
  state.edges[0].version = 10; state.components[0].version = 30;
  assert.deepEqual(command, { expectedVersion:11, expectedInstallationVersion:2, reason:'Remove to permanent quarantine', idempotencyKey:'remove-key', edgeId:'edge-a', expectedEdgeVersion:3, expectedUnitVersion:7 });
});

test('finalize captures aggregate versions and reason without client completion or source hashes', () => {
  assert.deepEqual(finalizeInstallationCommand(view(), { reason:'Exact parent evidence complete', status:'COMPLETE', k1:{ contentHash:'forged' }, graphVersion:999 }, 'final-key'), { expectedVersion:11, expectedInstallationVersion:2, reason:'Exact parent evidence complete', idempotencyKey:'final-key' });
});

test('installation capabilities remain separate from manufacturing, custody and lot genealogy rights', () => {
  const existing = ['manufacturing.read', 'manufacturing.record', 'custody.read', 'genealogy.read', 'genealogy.record', 'genealogy.finalize'];
  for (const action of ['installation.read', 'installation.record', 'installation.finalize', 'installation.remove']) assert.equal(installationCapability(action, existing).enabled, false);
  assert.equal(installationCapability('installation.record', ['installation.read']).enabled, false);
  assert.equal(installationCapability('installation.remove', undefined).enabled, false);
  assert.equal(installationCapability('installation.remove', ['installation.read', 'installation.remove']).enabled, true);
  assert.match(installationCapability('installation.finalize', []).reason, /finalize permission/);
});

test('history queries remain resource-scoped and encode cursor syntax', () => {
  assert.equal(installationPath('wo-id'), '/api/manufacturing/work-orders/wo-id/installations');
  assert.equal(installationPage(`${installationPath('wo-id')}/revisions`, 'cursor&other=1'), '/api/manufacturing/work-orders/wo-id/installations/revisions?limit=25&cursor=cursor%26other%3D1');
  assert.equal(installationPage(`${installationPath('wo-id')}/events`), '/api/manufacturing/work-orders/wo-id/installations/events?limit=25');
});

test('conflict hints distinguish permanent loss/retirement, frozen records and later source holds', () => {
  assert.match(installationHint({ code:'INSTALLATION_CHILD_UNAVAILABLE' }), /Removed and process-loss identities cannot be reused/);
  assert.match(installationHint({ code:'INSTALLATION_INCOMPLETE' }), /Retired identities block/);
  assert.match(installationHint({ code:'INSTALLATION_FROZEN' }), /whole work order/);
  assert.match(installationHint({ code:'STOCK_ENCUMBERED' }), /historical installation evidence remains available/);
  assert.equal(installationHint({ code:'UNRECOGNIZED' }), null);
});
