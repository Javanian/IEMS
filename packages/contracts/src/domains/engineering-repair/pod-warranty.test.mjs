import test from 'node:test';
import assert from 'node:assert/strict';
import { warrantyCalendarExpiry, validateRepairReturnShipment, issuePodWarranty } from '../../../../../apps/portfolio-api/src/repair-return.mjs';

test('POD warranty uses UTC calendar anniversary end-of-day and clamps short months', async () => {
  assert.equal(warrantyCalendarExpiry('2026-06-02T11:00:00.000Z', 12).toISOString(), '2027-06-02T23:59:59.000Z');
  assert.equal(warrantyCalendarExpiry('2026-01-31T11:00:00.000Z', 1).toISOString(), '2026-02-28T23:59:59.000Z');
  assert.equal(warrantyCalendarExpiry('2024-02-29T11:00:00.000Z', 12).toISOString(), '2025-02-28T23:59:59.000Z');
  for (const months of [0, -1, 1.5, 121, '12']) assert.throws(() => warrantyCalendarExpiry('2026-06-02T11:00:00Z', months), /INVALID_WARRANTY_PERIOD/);
  await assert.rejects(validateRepairReturnShipment(null, {}, {}, null), /ACTIVE_CALLER_TRANSACTION_REQUIRED/);
  await assert.rejects(issuePodWarranty(null, {}, {}, {}, null, new Date(), null), /ACTIVE_CALLER_TRANSACTION_REQUIRED/);
});
