import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityFor, utcMinute, gateId } from './gates.mjs';
import { requireQualityGates } from '../../../../../apps/portfolio-api/src/quality.mjs';
import { requireMaintenanceCapacity } from '../../../../../apps/portfolio-api/src/maintenance.mjs';
import { requireRepairInstallations } from '../../../../../apps/portfolio-api/src/repair-stock.mjs';

test('capacity unions overlapping downtime and keeps active overdue maintenance unavailable', () => {
  const from = '2026-11-01T00:00:00.000Z', until = '2026-11-01T04:00:00.000Z';
  const windows = [
    { from, until: '2026-11-01T01:30:00.000Z', status: 'PLANNED' },
    { from: '2026-11-01T01:00:00.000Z', until: '2026-11-01T02:00:00.000Z', status: 'PLANNED' },
    { from: '2026-11-01T02:00:00.000Z', until, status: 'CANCELLED' }
  ];
  assert.equal(capacityFor(windows, from, until).availableMinutes, '120');
  windows.push({ from: '2026-11-01T03:00:00.000Z', until: '2026-11-01T03:30:00.000Z', status: 'ACTIVE' });
  assert.equal(capacityFor(windows, from, until).availableMinutes, '60');
  windows[3] = { ...windows[3], status: 'COMPLETED', actualUntil: '2026-11-01T03:15:00.000Z' };
  assert.equal(capacityFor(windows, from, until).availableMinutes, '105');
  assert.notEqual(gateId('RECEIPT', 'same'), gateId('COMPANY_UNIT', 'same'));
  for (const bad of ['2026-11-01T00:00:00Z', '2026-02-30T00:00:00.000Z', '2026-11-01T00:00:01.000Z']) assert.throws(() => utcMinute(bad));
});
test('effect gates require an active caller transaction', async () => {
  await assert.rejects(requireQualityGates(null, {}, []), /ACTIVE_CALLER_TRANSACTION_REQUIRED/);
  await assert.rejects(requireMaintenanceCapacity(null, {}, 'equipment', {}), /ACTIVE_CALLER_TRANSACTION_REQUIRED/);
});
test('replacement conservation preserves rejected returns and legacy records while closing new physical scope', () => {
  const row = { replacementPolicy: 'CANONICAL_SPARES_V1', decision: { decision: 'REJECT' }, scopes: [{ findings: [{ component: 'Seal', disposition: 'REPLACE' }] }] };
  assert.doesNotThrow(() => requireRepairInstallations(row));
  row.decision.decision = 'ACCEPT';
  assert.throws(() => requireRepairInstallations(row), { code: 'REPLACEMENT_REQUIRED' });
  assert.doesNotThrow(() => requireRepairInstallations({ ...row, replacementPolicy: undefined }));
  row.componentRemovals = [{ componentId: 'original', component: 'Seal', authorizedDisposition: 'REPLACE' }];
  row.replacements = [{ _id: 'installed', component: 'Seal', removedComponentId: 'original' }];
  assert.doesNotThrow(() => requireRepairInstallations(row));
  row.componentRemovals.push({ componentId: 'again', component: 'Seal', sourceReplacementId: 'installed', authorizedDisposition: 'REPLACE' });
  assert.throws(() => requireRepairInstallations(row), { code: 'REPLACEMENT_REQUIRED' });
});
