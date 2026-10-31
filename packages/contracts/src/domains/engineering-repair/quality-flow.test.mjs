import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned } from '../../../../../apps/portfolio-api/test/support/owned-mongo.mjs';
import { requireQualityGates } from '../../../../../apps/portfolio-api/src/quality.mjs';
import { requireMaintenanceCapacity } from '../../../../../apps/portfolio-api/src/maintenance.mjs';

test('quality holds, calibration, qualifications and maintenance share transactional gates', async t => {
  const h = await startOwned(t), equipmentId = randomUUID(), path = `/repair/quality/resources/EQUIPMENT/${equipmentId}`;
  let equipment = await h.ok(path);
  const command = (version, values) => ({ expectedVersion: version, idempotencyKey: randomUUID(), evidence: 'Synthetic local quality evidence', ...values });
  const configured = command(0, { label: 'Synthetic test bench', disabled: false });
  assert.equal((await h.req(`${path}/configure`, configured, h.beta)).status, 200);
  equipment = await h.ok(`${path}/configure`, configured);
  assert.notEqual((await h.ok(path, undefined, 200, h.beta)).tenantId, equipment.tenantId);
  assert.equal(equipment.version, 1);
  const filter = { tenantId: equipment.tenantId, plantId: equipment.plantId };
  assert.deepEqual(await h.ok(`${path}/configure`, configured), equipment);
  const run = async effect => { const session = h.client.startSession(); try { return await session.withTransaction(() => effect(session)); } finally { await session.endSession(); } };
  const at = '2027-01-01T00:00:00.000Z', until = '2027-01-01T04:00:00.000Z';
  const target = { resourceType: 'EQUIPMENT', resourceId: equipmentId, requireCalibration: true };
  await assert.rejects(run(s => requireQualityGates(h.db, filter, [target], s, { at })), { code: 'CALIBRATION_REQUIRED' });
  equipment = await h.ok(`${path}/calibrate`, command(equipment.version, { validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2028-01-01T00:00:00.000Z', certificate: 'Synthetic certificate' }));
  await run(s => requireQualityGates(h.db, filter, [target], s, { at }));
  equipment = await h.ok(`${path}/hold`, command(equipment.version, { reasonCode: 'QUALITY_SUSPECT' }));
  await assert.rejects(run(s => requireQualityGates(h.db, filter, [target], s, { at })), { code: 'QUALITY_HOLD_ACTIVE' });
  assert.equal((await h.req(`${path}/release`, command(equipment.version, { holdId: randomUUID() }), h.alpha)).status, 409);
  equipment = await h.ok(`${path}/release`, command(equipment.version, { holdId: equipment.holds.at(-1)._id }));
  assert.equal((await h.req(`${path}/hold`, command(0, { reasonCode: 'SAFETY' }), h.alpha)).status, 409);
  const before = await h.db.collection('qualityResources').findOne({ tenantId: equipment.tenantId, resourceId: equipmentId });
  await h.db.command({ collMod: 'qualityOutbox', validator: { forbidden: { $exists: true } } });
  try {
    assert.equal((await h.req(`${path}/hold`, command(equipment.version, { reasonCode: 'SAFETY' }), h.alpha)).status, 500);
    assert.deepEqual(await h.db.collection('qualityResources').findOne({ tenantId: equipment.tenantId, resourceId: equipmentId }), before);
  } finally { await h.db.command({ collMod: 'qualityOutbox', validator: {} }); }
  const membership = await h.db.collection('memberships').findOne({ tenantId: equipment.tenantId, active: true }), operatorId = membership.userId;
  const op = `/repair/quality/resources/OPERATOR/${operatorId}`;
  let operator = await h.ok(`${op}/qualify`, command(0, { operation: 'PRESSURE', active: true, validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2028-01-01T00:00:00.000Z' }));
  await run(s => requireQualityGates(h.db, filter, [{ resourceType: 'OPERATOR', resourceId: operatorId, operation: 'PRESSURE' }], s, { at }));
  operator = await h.ok(`${op}/qualify`, command(operator.version, { operation: 'PRESSURE', active: false, validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2028-01-01T00:00:00.000Z' }));
  await assert.rejects(run(s => requireQualityGates(h.db, filter, [{ resourceType: 'OPERATOR', resourceId: operatorId, operation: 'PRESSURE' }], s, { at })), { code: 'QUALIFICATION_REQUIRED' });
  const maintenance = `/repair/maintenance/equipment/${equipmentId}`;
  const window = await h.ok(`${maintenance}/schedule`, command(0, { from: at, until: '2027-01-01T02:00:00.000Z', kind: 'PREVENTIVE' }));
  const capacity = await h.ok(`${maintenance}/capacity?${new URLSearchParams({ from: at, until })}`);
  assert.equal(capacity.availableMinutes, '120');
  await assert.rejects(run(s => requireMaintenanceCapacity(h.db, filter, equipmentId, { from: at, until, requiredMinutes: '121' }, s)), { code: 'MAINTENANCE_CAPACITY_EXCEEDED' });
  assert.equal((await run(s => requireMaintenanceCapacity(h.db, filter, equipmentId, { from: at, until, requiredMinutes: '120' }, s))).availableMinutes, '120');
  const restore = await h.setRoles(h.seeded[0], ['qualityRead']);
  try { assert.equal((await h.req(`${maintenance}/cancel`, command(window.version, { windowId: window.windows[0]._id }), h.alpha)).status, 403); } finally { await restore(); }
  await h.ok(`${maintenance}/cancel`, command(window.version, { windowId: window.windows[0]._id }));
  assert.equal((await h.ok(`${maintenance}/capacity?${new URLSearchParams({ from: at, until })}`)).availableMinutes, '240');
});
