import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startOwned } from './support/owned-mongo.mjs';
import { runE02Flow, e02Fixture, E02IncompleteError } from './support/review-e02-flow.mjs';

const fixtureUrl = new URL('../../../packages/domain-test-fixtures/src/scenarios/e02RepairCustomerAsset.js', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('canonical E02 runtime capability probe: full chain INCOMPLETE at approved VAT scope', async t => {
  const fixtureHash = digest(await readFile(fixtureUrl));
  assert.equal(fixtureHash, '6baee7beb75983827bd40f0064618af35b41e96ea6eba4ef3cb68dfdaba49d48');
  let clock = new Date(e02Fixture.repair_case.intake_date);
  const h = await startOwned(t, { businessClock: () => clock });
  const checkpoints = [];
  let incomplete;
  try {
    await runE02Flow(h, { setClock: date => { clock = date; }, onCheckpoint: async row => { checkpoints.push(row); } });
    assert.fail('This base has no canonical full E02 runtime success');
  } catch (error) {
    assert.ok(error instanceof E02IncompleteError, error.stack);
    incomplete = error;
  }
  const { flow, gap } = incomplete;
  assert.equal(flow.manifest.status, 'INCOMPLETE');
  assert.equal(gap.path, `/repair/cases/${flow.case._id}/scope`);
  assert.equal(gap.expectedStatus, 200); assert.equal(gap.actual.status, 409);
  // Wall-clock expiry masks the following explicit NO_TAX-only guard on the allocated base.
  const expiredOnWallClock = Date.now() >= Date.parse(e02Fixture.quotation.revisions[1].expiry_date);
  assert.equal(gap.actual.error.code, expiredOnWallClock ? 'SCOPE_CONFLICT' : 'TAX_POLICY_UNSUPPORTED');
  assert.equal(gap.businessAt, new Date(e02Fixture.scope_authorization.approved_at).toISOString());
  assert.ok(Date.parse(gap.businessAt) < Date.parse(e02Fixture.quotation.revisions[1].expiry_date));
  const actual = await h.ok(`/repair/cases/${flow.case._id}`);
  assert.deepEqual(actual, flow.case, 'Rejected scope must leave case unchanged');
  assert.equal(actual.status, 'TEARDOWN'); assert.equal(actual.scopes.length, 0);
  assert.equal(actual.serial, e02Fixture.customer_asset.serial_no);
  assert.equal(actual.ownerAccountId, flow.account._id);
  assert.deepEqual(actual.findings.map(row => row.disposition), ['REUSE', 'REPAIR', 'REPLACE']);
  const quote = await h.ok(`/commercial/quotes/${flow.quote._id}`);
  assert.equal(quote.status, 'APPROVED'); assert.equal(quote.revisions.length, 2);
  assert.equal(quote.revisions[0].total, '10545.00');
  assert.equal(quote.revisions[1].netAmount, '9000.00');
  assert.equal(quote.revisions[1].taxAmount, '990.00'); assert.equal(quote.revisions[1].total, '9990.00');
  for (const name of ['repairDeposits', 'repairInvoices', 'repairPayments', 'repairRemovedComponents', 'repairMaterialAuthorizations', 'catalogMaterialReservations', 'companyMaterialReservations', 'warehouseReceipts', 'internalCompanyStockReceipts', 'fulfillmentShipments', 'deliveryConfirmations']) {
    assert.equal(await h.db.collection(name).countDocuments(), 0, `${name}: no fabricated downstream evidence`);
  }
  assert.equal(checkpoints.at(-1).milestone, 'INCOMPLETE');
  assert.equal(digest(await readFile(fixtureUrl)), fixtureHash);
  t.diagnostic(JSON.stringify({ fixtureHash, manifest: flow.manifest, runtimeResult: 'INCOMPLETE; test PASS proves the blocking response only, never full-chain acceptance' }));
});
