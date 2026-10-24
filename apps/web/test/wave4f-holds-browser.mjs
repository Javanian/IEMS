import assert from 'node:assert/strict';
import { api, poster, key, scoped, openContext } from './wave4f-browser-kit.mjs';

// Wave 4f named scenarios: stock hold lifecycle through the product UI against the actual API and owned Mongo.
// Fixtures (PO receipt, sales order, reservation, released WO) are API setup only; every assessed hold action is a
// native Chrome interaction, and effects are asserted independently in Mongo.
const APPLY = 'form[aria-labelledby="apply-hold-heading"]';
const releaseForm = id => `li[data-hold-id="${id}"] form`;

export async function holdJourney(ctx) {
  const { db, call, wait, evaluate, screenshot, check, headers, loseResponse, web } = ctx;
  const request = api(headers), post = poster(request);
  const { fillIn, clickIn, disabledReason } = scoped({ evaluate, wait });
  const owner = await db.collection('credentials').findOne({ username: 'alpha.owner' });

  // ---- Fixture setup through the API (not assessed) ----
  const account = await db.collection('accounts').findOne({ name: 'Synthetic browser account' });
  const vendorId = (await db.collection('purchaseOrders').findOne({})).vendorId;
  const pr = await post('procurement/requests', { vendorId, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'W4F held coating material', quantity: '4.000000', uom: 'EA', unitPrice: '1.00', currency: 'USD' }] });
  await post(`procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await post(`procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: key() });
  await post(`procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const created = await post('warehouse/receipts', { purchaseOrderId: po._id, vendorId: po.vendorId, expectedVersion: 2, lineIndex: 0, quantity: '4.000000', uom: 'EA', idempotencyKey: key() });
  const rid = created._id;
  await post(`warehouse/receipts/${rid}/release`, { expectedVersion: 1, reason: 'W4F operator inspection', idempotencyKey: key() });
  await post(`warehouse/receipts/${rid}/putaway`, { expectedVersion: 2, location: 'W4F-HOLD-BIN', idempotencyKey: key() });
  const quote = await post('commercial/quotes', { accountId: account._id, expiresAt: '2027-12-31T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'W4F assembly on held stock', quantity: '5.000', uom: 'EA', unitPrice: '10.00', currency: 'USD' }] });
  await post(`commercial/quotes/${quote._id}/approve`, { expectedVersion: 1, revision: 1 });
  await post(`commercial/quotes/${quote._id}/accept`, { expectedVersion: 2, revision: 1 });
  const so = await post(`commercial/quotes/${quote._id}/convert`, { expectedVersion: 3, revision: 1, idempotencyKey: key() });
  await post(`warehouse/receipts/${rid}/reserve`, { expectedVersion: 3, idempotencyKey: key(), salesOrderId: so._id, accountId: account._id, lineIndex: 0, quantity: '1', uom: 'EA' });
  const soRow = await db.collection('salesOrders').findOne({ _id: so._id });
  const planned = await post('manufacturing/work-orders', { salesOrderId: so._id, expectedVersion: soRow.version, lineIndex: 0, uom: 'EA', quantities: ['2'], idempotencyKey: key() });
  const woId = planned.workOrders[0]._id;
  await post(`manufacturing/work-orders/${woId}/release`, { expectedVersion: 1, idempotencyKey: key(), operations: [{ code: 'ASSY', instruction: 'Assemble with coated material' }], materials: [{ receiptId: rid, quantityPerUnit: '1', uom: 'EA' }] });
  const reservation = await db.collection('warehouseReservations').findOne({ receiptId: rid });
  let receipt = await db.collection('warehouseReceipts').findOne({ _id: rid });
  assert.equal(receipt.status, 'STORED'); assert.equal(receipt.availableQuantity, '1'); assert.ok(reservation);
  const woBefore = await db.collection('manufacturingWorkOrders').findOne({ _id: woId });
  assert.equal(woBefore.status, 'RELEASED');
  const effects = async () => Object.fromEntries(await Promise.all([
    ['holds', 'stockHolds', { receiptId: rid }], ['active', 'stockHolds', { receiptId: rid, status: 'ACTIVE' }], ['keys', 'stockHoldKeys', {}],
    ['applied', 'warehouseAudit', { receiptId: rid, kind: 'stock.hold.applied' }], ['released', 'warehouseAudit', { receiptId: rid, kind: 'stock.hold.released' }],
    ['outbox', 'warehouseOutbox', { receiptId: rid, type: { $in: ['stock.hold.applied.v1', 'stock.hold.released.v1'] }, state: 'PENDING' }],
    ['movements', 'warehouseMovements', { receiptId: rid }], ['woMovements', 'manufacturingMovements', { workOrderId: woId }],
  ].map(async ([k, n, f]) => [k, await db.collection(n).countDocuments(f)])));
  const unchangedStock = async () => {
    const r = await db.collection('warehouseReceipts').findOne({ _id: rid });
    assert.equal(r.availableQuantity, '1'); assert.equal(r.quantity, receipt.quantity); assert.equal(r.reservedQuantity, receipt.reservedQuantity); assert.equal(r.manufacturingReservedQuantity, receipt.manufacturingReservedQuantity);
    assert.deepEqual(await db.collection('warehouseReservations').findOne({ _id: reservation._id }), reservation, 'hold never cancels or rewrites the sales reservation');
    const wo = await db.collection('manufacturingWorkOrders').findOne({ _id: woId });
    assert.deepEqual({ status: wo.status, routing: wo.routing, records: wo.records, version: wo.version }, { status: woBefore.status, routing: woBefore.routing, records: woBefore.records, version: woBefore.version }, 'hold never rewrites the WO snapshot');
    return r;
  };
  const base = await effects();

  // ---- Scenario W4F-H1: owner applies a whole-receipt hold in Chrome ----
  const open = async () => { await call('Page.navigate', { url: `${web}/portfolio/warehouse/receipts/${rid}` }); await wait(`document.querySelector('[data-testid=receipt-holds]') && document.querySelector('${APPLY} select[name=reasonCode]:not(:disabled)')`, 'receipt holds panel ready'); };
  await open();
  assert.ok(await evaluate(`document.querySelector('[data-hold-state=clear]')!==null`));
  await wait(`document.querySelector('${APPLY}').innerText.includes('receipt version ${receipt.version}')`);
  await fillIn(APPLY, 'reasonCode', 'QC_SUSPECT'); await fillIn(APPLY, 'reasonNote', 'Suspect coating thickness seen in Chrome');
  await clickIn(APPLY, 'Apply hold');
  await wait(`document.querySelector('[data-hold-state=held]') && document.querySelectorAll('li[data-hold-id]').length===1`, 'hold applied and listed');
  const holdA = await db.collection('stockHolds').findOne({ receiptId: rid, status: 'ACTIVE' });
  assert.equal(holdA.reasonCode, 'QC_SUSPECT'); assert.equal(holdA.reasonNote, 'Suspect coating thickness seen in Chrome'); assert.equal(holdA.appliedBy.userId, owner._id); assert.equal(holdA.version, 1);
  receipt = await unchangedStock();
  assert.deepEqual(receipt.hold.activeHoldIds, [holdA._id]); assert.equal(receipt.hold.active, true);
  assert.deepEqual(await effects(), { ...base, holds: 1, active: 1, keys: base.keys + 1, applied: 1, outbox: base.outbox + 1 });
  await wait(`document.querySelector('[aria-label="Hold impacts"]')?.innerText.includes('Sales reservation · 1') && document.querySelector('[aria-label="Hold impacts"]').innerText.includes('Manufacturing reservation · 2')`, 'impacts listed');
  assert.ok(await evaluate(`document.body.innerText.includes('still reserved') && document.body.innerText.includes('has not been cancelled')`));
  await screenshot('wave4f-hold-applied');
  check('W4F-H1 hold apply: Chrome whole-receipt hold, reason/actor/impacts shown; independent Mongo hold/cache/audit/outbox/key once; reservation, WO snapshot, quantities and movements unchanged');

  // ---- Scenario W4F-H2: stale receipt version conflict from a real second writer ----
  const writer = await request(`warehouse/receipts/${rid}/holds`, { reasonCode: 'DOCUMENT_MISMATCH', reasonNote: 'Independent API writer: packing list mismatch', expectedReceiptVersion: receipt.version }, { 'idempotency-key': key() });
  assert.equal(writer.status, 201, JSON.stringify(writer));
  const holdB = writer.data.hold;
  const afterWriter = await effects();
  await fillIn(APPLY, 'reasonCode', 'DAMAGED'); await fillIn(APPLY, 'reasonNote', 'Stale browser attempt');
  await clickIn(APPLY, 'Apply hold');
  assert.equal(await disabledReason(APPLY, 'Apply hold'), 'Receipt changed, reload to continue');
  assert.ok(await evaluate(`document.body.innerText.includes('Receipt changed (now version ${receipt.version + 1}), reload to continue')`));
  assert.deepEqual(await effects(), afterWriter, 'stale apply has no effect');
  await screenshot('wave4f-hold-stale-conflict');
  await clickIn(APPLY, 'Reload holds');
  await wait(`document.querySelectorAll('li[data-hold-id]').length===2 && document.querySelector('${APPLY}').innerText.includes('receipt version ${receipt.version + 1}') && !document.querySelector('${APPLY} button.pf-primary').disabled`, 'reloaded current version');
  check('W4F-H2 hold stale version: real second writer, browser 409 shows specific disabled reason, no effect, explicit reload restores current version');

  // ---- Scenario W4F-H3: offline release, identical retry, reload; one release leaves the other hold active ----
  await fillIn(releaseForm(holdA._id), 'reasonCode', 'INSPECTION_PASSED'); await fillIn(releaseForm(holdA._id), 'reasonNote', 'Re-measured within tolerance in Chrome');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await clickIn(releaseForm(holdA._id), 'Release hold');
  await wait(`[...document.querySelectorAll('${releaseForm(holdA._id)} button')].some(b=>b.textContent==='Retry same request'&&!b.disabled)`, 'offline release offers identical retry');
  assert.equal((await db.collection('stockHolds').findOne({ _id: holdA._id })).status, 'ACTIVE');
  const beforeRetry = await effects();
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await clickIn(releaseForm(holdA._id), 'Retry same request');
  await wait(`document.body.innerText.includes('Hold released. Other active holds on this receipt are unchanged.') && document.querySelectorAll('li[data-hold-id]').length>=2 && !document.querySelector('${releaseForm(holdA._id)}')`, 'release committed');
  const releasedA = await db.collection('stockHolds').findOne({ _id: holdA._id });
  assert.equal(releasedA.status, 'RELEASED'); assert.equal(releasedA.releaseReasonCode, 'INSPECTION_PASSED'); assert.equal(releasedA.releasedBy.userId, owner._id); assert.equal(releasedA.version, 2);
  assert.equal((await db.collection('stockHolds').findOne({ _id: holdB.id })).status, 'ACTIVE');
  receipt = await unchangedStock();
  assert.deepEqual(receipt.hold.activeHoldIds, [holdB.id]); assert.equal(receipt.hold.active, true);
  assert.deepEqual(await effects(), { ...beforeRetry, active: 1, keys: beforeRetry.keys + 1, released: 1, outbox: beforeRetry.outbox + 1 });
  const origin = await evaluate('performance.timeOrigin');
  await call('Page.reload');
  await wait(`performance.timeOrigin!==${origin} && document.querySelector('[data-hold-state=held]') && document.body.innerText.includes('Released holds (1)') && document.querySelector('${releaseForm(holdB.id)}')`, 'reload restores hold state');
  check('W4F-H3 hold release: genuine offline failure, identical-key retry commits once, other active hold untouched, hard reload restores persisted state');

  // ---- Scenario W4F-H4: committed response lost; UI retry replays the same key ----
  await fillIn(APPLY, 'reasonCode', 'CUSTOMER_COMPLAINT'); await fillIn(APPLY, 'reasonNote', 'Customer reported flaking, response-loss check');
  const beforeLoss = await effects();
  const lost = await loseResponse(`*warehouse/receipts/${rid}/holds`, () => clickIn(APPLY, 'Apply hold'), async ({ receipt: body }) => {
    assert.equal((await db.collection('stockHolds').findOne({ _id: body.data.hold.id })).status, 'ACTIVE');
  });
  await wait(`[...document.querySelectorAll('${APPLY} button')].some(b=>b.textContent==='Retry same request'&&!b.disabled)`, 'lost response offers identical retry');
  const committed = await effects();
  assert.deepEqual(committed, { ...beforeLoss, holds: beforeLoss.holds + 1, active: beforeLoss.active + 1, keys: beforeLoss.keys + 1, applied: beforeLoss.applied + 1, outbox: beforeLoss.outbox + 1 });
  await clickIn(APPLY, 'Retry same request');
  await wait(`document.body.innerText.includes('Hold applied. The whole receipt is now on hold.') && document.querySelectorAll('li[data-hold-id]').length===3`, 'replayed apply rendered');
  assert.deepEqual(await effects(), committed, 'UI retry replayed; no second hold');
  const holdC = lost.receipt.data.hold;
  const sentKey = Object.entries(lost.headers).find(([k]) => k.toLowerCase() === 'idempotency-key')[1];
  const replay = await request(`warehouse/receipts/${rid}/holds`, lost.command, { 'idempotency-key': sentKey });
  assert.equal(replay.status, 201); assert.deepEqual(replay.data, lost.receipt.data);
  const reused = await request(`warehouse/receipts/${rid}/holds`, { ...lost.command, reasonNote: 'Changed body, same key' }, { 'idempotency-key': sentKey });
  assert.equal(reused.status, 409); assert.equal(reused.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(await effects(), committed);
  check('W4F-H4 hold idempotency: committed response withheld, Chrome retry and independent same-key replay return the stored 201 once; changed body with same key 409');

  // ---- Scenario W4F-H5: stock exception on affected WO and sales order; consumption stays blocked ----
  await call('Page.navigate', { url: `${web}/portfolio/manufacturing/work-orders/${woId}` });
  await wait(`document.querySelector('[data-testid=stock-exceptions]') && document.querySelector('[name=goodQuantity]')`, 'WO stock exception');
  const woText = await evaluate(`document.querySelector('[data-testid=stock-exceptions]').innerText`);
  assert.match(woText, /is on hold/); assert.match(woText, /has not been cancelled/); assert.doesNotMatch(woText, /safe to|can continue/i);
  assert.ok(await evaluate(`document.body.innerText.includes('Status: RELEASED')`));
  const RECORD = 'form:has([name=goodQuantity])';
  await fillIn(RECORD, 'goodQuantity', '2'); await fillIn(RECORD, 'scrapQuantity', '0'); await fillIn(RECORD, 'evidence', 'Attempt to consume held material');
  await clickIn(RECORD, 'Record operation');
  await wait(`document.body.innerText.includes('A material receipt is on hold. Nothing was consumed')`, 'consumption refused with hold hint');
  assert.equal((await effects()).woMovements, base.woMovements); await unchangedStock();
  await screenshot('wave4f-wo-stock-exception');
  await call('Page.navigate', { url: `${web}/portfolio/orders/${so._id}` });
  await wait(`document.querySelector('[data-order-exceptions] [data-testid=stock-exceptions]')`, 'sales order stock exception');
  assert.match(await evaluate(`document.querySelector('[data-testid=stock-exceptions]').innerText`), /has not been cancelled/);
  check('W4F-H5 stock exception: WO and sales order show held material without claiming cancellation; Chrome consume attempt refused STOCK_ENCUMBERED with zero movements');
  const pendingFailures = [], interceptionErrors = [];
  const failExceptionRead = event => {
    if (event.method === 'Fetch.requestPaused') pendingFailures.push(call('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'ConnectionClosed' }).catch(error => interceptionErrors.push(error)));
  };
  ctx.listeners.add(failExceptionRead);
  await call('Fetch.enable', { patterns: [{ urlPattern: '*warehouse/reservations*', requestStage: 'Request' }] });
  try {
    await call('Page.reload');
    await wait(`document.body.innerText.includes('Stock exception data unavailable') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Reload stock exceptions')`, 'exception failure is visible, not clearance');
  } finally { ctx.listeners.delete(failExceptionRead); await Promise.all(pendingFailures); await call('Fetch.disable'); }
  for (const error of interceptionErrors) assert.deepEqual(error, { code: -32602, message: 'Invalid InterceptionId.' }, 'only already-aborted reload requests may lose interception identity');
  console.log('W4F-H8 aborted reload interceptions', interceptionErrors.length);
  await clickIn('.pf-main', 'Reload stock exceptions');
  await wait(`document.querySelector('[data-order-exceptions] [data-testid=stock-exceptions]') && !document.body.innerText.includes('Stock exception data unavailable')`, 'native exception reload restores hold');
  check('W4F-H8 exception-read transport failure stays visible with no clearance claim; native reload restores actual held-stock warning');

  // ---- Scenario W4F-H6: separation of duties with seeded users in isolated browser contexts ----
  const inspector = await openContext(ctx, 'alpha.inspector', `/portfolio/warehouse/receipts/${rid}`);
  try {
    await inspector.wait(`document.querySelector('${releaseForm(holdB.id)}') && document.querySelector('${APPLY}')`, 'inspector sees holds');
    assert.equal(await inspector.disabledReason(releaseForm(holdB.id), 'Release hold'), 'You need hold release permission');
    assert.equal(await inspector.evaluate(`document.querySelector('${APPLY} button.pf-primary').disabled`), false, 'inspector may apply');
    const before = await effects();
    const denied = await request(`warehouse/holds/${holdB.id}/release`, { reasonCode: 'OTHER', reasonNote: 'Inspector tries release', expectedVersion: 1 }, { cookie: inspector.cookie, 'idempotency-key': key() });
    assert.equal(denied.status, 403); assert.deepEqual(await effects(), before);
    await screenshot('wave4f-inspector-release-denied');
  } finally { await inspector.close(); }
  const viewer = await openContext(ctx, 'alpha.viewer', `/portfolio/warehouse/receipts/${rid}`);
  try {
    await viewer.wait(`document.querySelector('${APPLY}')`, 'viewer sees holds');
    assert.equal(await viewer.disabledReason(APPLY, 'Apply hold'), 'You need hold apply permission');
    assert.equal(await viewer.disabledReason(releaseForm(holdB.id), 'Release hold'), 'You need hold release permission');
    const before = await effects(), version = (await db.collection('warehouseReceipts').findOne({ _id: rid })).version;
    const denied = await request(`warehouse/receipts/${rid}/holds`, { reasonCode: 'OTHER', reasonNote: 'Viewer tries apply', expectedReceiptVersion: version }, { cookie: viewer.cookie, 'idempotency-key': key() });
    assert.equal(denied.status, 403); assert.deepEqual(await effects(), before);
  } finally { await viewer.close(); }
  check('W4F-H6 hold permissions: alpha.inspector release and alpha.viewer apply/release disabled with specific reasons in Chrome; independent server 403 with zero effects');

  // ---- Scenario W4F-H7: quality releases the remaining holds; exception clears; ledger reconciles ----
  const quality = await openContext(ctx, 'alpha.quality', `/portfolio/warehouse/receipts/${rid}`);
  const qualityUser = await db.collection('credentials').findOne({ username: 'alpha.quality' });
  try {
    for (const hold of [holdB, holdC]) {
      await quality.fillIn(releaseForm(hold.id), 'reasonCode', 'DISPOSITION_ACCEPTED'); await quality.fillIn(releaseForm(hold.id), 'reasonNote', 'Quality disposition accepted in Chrome');
      await quality.clickIn(releaseForm(hold.id), 'Release hold');
      await quality.wait(`!document.querySelector('${releaseForm(hold.id)}') && document.body.innerText.includes('Hold released.')`, `quality released ${hold.id}`);
      const row = await db.collection('stockHolds').findOne({ _id: hold.id });
      assert.equal(row.status, 'RELEASED'); assert.equal(row.releasedBy.userId, qualityUser._id);
    }
    await quality.wait(`document.querySelector('[data-hold-state=clear]') && document.body.innerText.includes('Released holds (3)')`, 'receipt clear');
  } finally { await quality.close(); }
  receipt = await unchangedStock();
  assert.deepEqual(receipt.hold, { ...receipt.hold, active: false, activeHoldIds: [] });
  const final = await effects();
  assert.deepEqual(final, { ...base, holds: 3, active: 0, keys: base.keys + 6, applied: 3, released: 3, outbox: base.outbox + 6 }, 'three applies (UI, API writer, UI) and three releases, each exactly once');
  assert.equal((await request(`warehouse/receipts/${rid}/reconciliation`)).data.matches, true);
  assert.deepEqual([receipt.quantity, receipt.availableQuantity, receipt.reservedQuantity, receipt.manufacturingReservedQuantity], ['4.000000', '1', '1', '2'], 'conservation 4 = 1 available + 1 sales + 2 manufacturing; holds never move stock');
  await call('Page.navigate', { url: `${web}/portfolio/manufacturing/work-orders/${woId}` });
  await wait(`document.querySelector('[name=goodQuantity]') && !document.querySelector('[data-testid=stock-exceptions]')`, 'WO exception cleared');
  await call('Page.navigate', { url: `${web}/portfolio/warehouse/holds?status=RELEASED` });
  await wait(`document.querySelectorAll('.pf-rows li').length>=3 && document.body.innerText.includes('Released by alpha.quality')`, 'released hold list');
  await screenshot('wave4f-holds-released-list');
  check('W4F-H7 hold release by alpha.quality in Chrome: all holds released exactly once, receipt cache clear, WO exception gone, stock ledger reconciles, list shows actor history');
}
