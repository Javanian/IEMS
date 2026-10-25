import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { companyStockContext, writeCompanyReservation } from '../../../apps/portfolio-api/src/company-stock.mjs';
import { stockHash, stockHashless } from '../../../apps/portfolio-api/src/catalog-stock-use-state.mjs';
import { startOwned, command, executionRoot, snapshot, denied, replaceWhile, makeFixture, makeConsumer, getExecution, getCompany, reserveCompanyBody, reserveDirectLot, companyHold, producerEvidence, assertProducerConserved } from './support.mjs';

test('independent one-generation company component use, authority and conservation', async t => {
  const h = await startOwned(t), f = await makeFixture(h), sourceId = f.producer.companyStock._id;
  const path = execution => `${executionRoot}/${execution._id}`, sourcePath = `/company-stock/receipts/${sourceId}`;
  const update = (view, values = {}) => command({ expectedVersion: view.version, ...values });
  const producerPhysical = await producerEvidence(h, f);
  const forbiddenNames = ['accounts', 'contacts', 'opportunities', 'quotes', 'salesOrders', 'manufacturingWorkOrders', 'manufacturingAllocated', 'manufacturingOutputUnits', 'warehouseReservations', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'fulfillmentTallies'];
  const forbidden = () => Promise.all(forbiddenNames.map(name => h.db.collection(name).find({}).sort({ _id: 1 }).toArray())), forbiddenBefore = await forbidden();
  const warehouseMovements = () => h.db.collection('warehouseMovements').find({}).sort({ _id: 1 }).toArray(), originalMovements = await warehouseMovements();
  let a, b, main, acknowledgedReserve, acknowledgedReserveResult, acknowledgedIssue;

  await t.test('only actual accepted company identities are available and foreign scope or mixed wire has no effects', async () => {
    const source = await getCompany(h, sourceId);
    assert.equal(source.sourcePolicy, 'ONE_HOP_SOURCE'); assert.equal(source.openingQuantity, '2');
    assert.equal(source.onHandQuantity, '2'); assert.equal(source.availableQuantity, '2'); assert.equal(source.eligibleQuantity, '2');
    assert.equal(source.units.length, 2); assert.deepEqual(source.units.map(unit => unit.serial).sort(), f.produced.slice(0, 2).sort());
    assert.equal(source.canReserve, true); assert.equal(source.canAllocate, false); assert.equal(source.canDispatch, false);
    await denied(h, sourcePath, undefined, 404, 'NOT_FOUND', h.beta);
    a = await makeConsumer(h, f); b = await makeConsumer(h, f);
    const body = reserveCompanyBody(a, source, [source.units[0]], f.componentItem._id);
    await denied(h, `${path(a)}/reservations`, { ...body, receiptId: f.producerLot._id }, 400, 'UNKNOWN_FIELD');
    await denied(h, `${path(a)}/reservations`, { ...body, serials: [source.units[0].serial] }, 400, 'UNKNOWN_FIELD');
    await denied(h, `${path(a)}/reservations`, { ...body, expectedStockVersion: source.version + 1 }, 409, 'VERSION_CONFLICT');
    await denied(h, `${path(a)}/reservations`, { ...body, quantity: '0.5' }, 400, 'INVALID_SERIALS');
    await denied(h, `${path(a)}/reservations`, { ...body, quantity: '2', units: [body.units[0], body.units[0]] }, 400, 'INVALID_SERIALS');
    await denied(h, `${path(a)}/reservations`, { ...body, units: [{ companyUnitId: randomUUID(), expectedUnitVersion: 1 }] }, 409, 'VERSION_CONFLICT');
    assertProducerConserved(await producerEvidence(h, f), producerPhysical);
  });

  await t.test('direct company holds roll back atomically, preserve physical evidence and permit authorized historical replay only', async () => {
    let source = await getCompany(h, sourceId);
    const body = update(source, { reasonCode: 'QUALITY_SUSPECT' });
    await h.db.command({ collMod: 'companyStockOutbox', validator: { $jsonSchema: { required: ['QA_REQUIRED_FAULT'] } }, validationLevel: 'strict', validationAction: 'error' });
    try { await denied(h, `${sourcePath}/holds`, body, 500, 'INTERNAL_ERROR'); }
    finally { await h.db.command({ collMod: 'companyStockOutbox', validator: {} }); }
    source = await h.ok(`${sourcePath}/holds`, body);
    assert.equal(source.hold.active, true); assert.equal(source.onHandQuantity, '2'); assert.equal(source.availableQuantity, '2'); assert.equal(source.eligibleQuantity, '0');
    const committed = await snapshot(h); assert.deepEqual(await h.ok(`${sourcePath}/holds`, body), source); assert.deepEqual(await snapshot(h), committed);
    const current = await getExecution(h, a), reserve = reserveCompanyBody(current, source, source.units, f.componentItem._id);
    await denied(h, `${path(a)}/reservations`, reserve, 409, 'STOCK_ENCUMBERED');
    const identity = h.seeded.find(row => row.username === 'alpha.owner'), member = await h.db.collection('memberships').findOne({ _id: identity.membershipId });
    await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'companyStockReader', plantIds: member.plantIds }] } });
    try { await denied(h, `${sourcePath}/holds`, body, 403, 'SCOPE_DENIED'); }
    finally { await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    await companyHold(h, sourceId, { release: true });
    assertProducerConserved(await producerEvidence(h, f), producerPhysical);
  });

  await t.test('two authorized HTTP claimants produce one durable winner and the uncommitted loser key remains reusable', async () => {
    const source = await getCompany(h, sourceId), selected = [source.units[0]];
    const attempts = [{ execution: a, body: reserveCompanyBody(a, source, selected, f.componentItem._id) }, { execution: b, body: reserveCompanyBody(b, source, selected, f.componentItem._id) }];
    const responses = await Promise.all(attempts.map(row => h.req(`${path(row.execution)}/reservations`, row.body, h.alpha)));
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    const winnerIndex = responses.findIndex(row => row.status === 200), loserIndex = 1 - winnerIndex;
    assert.equal(responses[loserIndex].error.code, 'VERSION_CONFLICT');
    assert.equal(await h.db.collection('internalExecutionKeys').countDocuments({ key: attempts[winnerIndex].body.idempotencyKey }), 1);
    assert.equal(await h.db.collection('internalExecutionKeys').countDocuments({ key: attempts[loserIndex].body.idempotencyKey }), 0);
    const after = await getCompany(h, sourceId); assert.equal(after.reservedQuantity, '1'); assert.equal(after.availableQuantity, '1'); assert.equal(after.onHandQuantity, '2');
    assert.equal(await h.db.collection('companyMaterialReservations').countDocuments({ companyReceiptId: sourceId, status: 'RESERVED' }), 1);
    acknowledgedReserve = attempts[winnerIndex]; acknowledgedReserveResult = responses[winnerIndex].data;
    const retry = reserveCompanyBody(await getExecution(h, attempts[loserIndex].execution), after, after.units.filter(unit => unit.status === 'AVAILABLE'), f.componentItem._id);
    retry.idempotencyKey = attempts[loserIndex].body.idempotencyKey;
    await h.ok(`${path(attempts[loserIndex].execution)}/reservations`, retry);
    assert.equal((await getCompany(h, sourceId)).reservedQuantity, '2');
    assertProducerConserved(await producerEvidence(h, f), producerPhysical);
  });

  await t.test('real domain writer CAS conflicts after separate validated reads without removing HTTP authorization fences', async () => {
    const filter = { tenantId: f.producer.tenantId, plantId: f.producer.plantId }, claims = await h.db.collection('companyMaterialReservations').find({ companyReceiptId: sourceId, status: 'RESERVED' }).sort({ _id: 1 }).toArray();
    assert.equal(claims.length, 2); assert.notEqual(claims[0].executionId, claims[1].executionId);
    const before = await snapshot(h), s1 = h.client.startSession(), s2 = h.client.startSession();
    try {
      s1.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      s2.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      const c1 = await companyStockContext(h.db, filter, sourceId, s1), c2 = await companyStockContext(h.db, filter, sourceId, s2);
      assert.equal(c1.use.version, c2.use.version);
      const actor = h.seeded.find(row => row.username === 'alpha.owner').userId;
      await writeCompanyReservation(h.db, filter, c1, { ...claims[0], status: 'RELEASED' }, actor, 'Independent first pending source writer', s1);
      await assert.rejects(writeCompanyReservation(h.db, filter, c2, { ...claims[1], status: 'RELEASED' }, actor, 'Independent stale source writer', s2), error => error.code === 112 || error.code === 'VERSION_CONFLICT');
    } finally {
      if (s1.inTransaction()) await s1.abortTransaction(); if (s2.inTransaction()) await s2.abortTransaction();
      await s1.endSession(); await s2.endSession();
    }
    assert.deepEqual(await snapshot(h), before);
    // Both domain-only transactions abort; durable winner semantics are proved by the HTTP case above.
  });

  await t.test('same-key replay remains exact under a later hold and dedicated company permission is rechecked before replay', async () => {
    const source = await companyHold(h, sourceId), body = acknowledgedReserve.body, route = `${path(acknowledgedReserve.execution)}/reservations`;
    const before = await snapshot(h); assert.deepEqual(await h.ok(route, body), acknowledgedReserveResult); assert.deepEqual(await snapshot(h), before);
    await denied(h, route, { ...body, reason: 'Changed captured command is forbidden' }, 409, 'IDEMPOTENCY_CONFLICT');
    const identity = h.seeded.find(row => row.username === 'alpha.owner'), member = await h.db.collection('memberships').findOne({ _id: identity.membershipId });
    await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: ['internalExecutionReserve', 'companyStockReader'].map(role => ({ role, plantIds: member.plantIds })) } });
    try {
      await denied(h, route, body, 403, 'SCOPE_DENIED');
      const head = await h.db.collection('internalExecutions').findOne({ _id: acknowledgedReserve.execution._id });
      assert.equal(head.schema, 'INTERNAL_EXECUTION_V2');
      const receipt = await h.db.collection('internalExecutionKeys').findOne({ key: body.idempotencyKey });
      assert.equal(receipt.result.schema, 'INTERNAL_EXECUTION_V2');
      await h.db.collection('internalExecutions').deleteOne({ _id: head._id });
      try { await denied(h, route, body, 403, 'SCOPE_DENIED'); }
      finally { await h.db.collection('internalExecutions').insertOne(head); }
      await replaceWhile(h, 'internalExecutions', head, { ...head, schema: 'INTERNAL_EXECUTION_V1' }, async () => {
        await denied(h, route, body, 403, 'SCOPE_DENIED');
      });
    }
    finally { await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    for (const execution of [a, b]) {
      const current = await getExecution(h, execution), stock = await getCompany(h, sourceId), claim = current.reservations.find(row => row.sourceKind === 'COMPANY_OUTPUT' && row.status === 'RESERVED');
      await h.ok(`${path(current)}/reservations/${claim._id}/release`, update(current, { expectedStockVersion: stock.version }));
    }
    const held = await getCompany(h, sourceId); assert.equal(held.availableQuantity, '2'); assert.equal(held.eligibleQuantity, '0'); assert.equal(held.hold._id, source.hold._id);
    await companyHold(h, sourceId, { release: true });
  });

  await t.test('abandoned raw hold is audit history rather than consumed ancestry while a real ancestor or malformed cache blocks fresh use', async () => {
    const rawHold = async receipt => { const source = await h.ok(`/catalog-stock/receipts/${receipt._id}`); const response = await h.send(`/warehouse/receipts/${receipt._id}/holds`, { body: { expectedReceiptVersion: source.receiptVersion, reasonCode: 'QC_SUSPECT', reasonNote: 'Independent actual ancestor hold' }, headers: { 'Idempotency-Key': randomUUID() } }); assert.equal(response.status, 201); return response.data.hold; };
    const releaseRaw = hold => h.send(`/warehouse/holds/${hold.id}/release`, { body: { expectedVersion: hold.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Independent restored ancestor eligibility' }, headers: { 'Idempotency-Key': randomUUID() } });
    const abandonedHold = await rawHold(f.abandoned);
    try { const source = await getCompany(h, sourceId); assert.equal(source.eligibleQuantity, '2'); assert.equal(source.blockers.includes('ANCESTOR_HELD'), false); }
    finally { assert.equal((await releaseRaw(abandonedHold)).status, 200); }
    const activeHold = await rawHold(f.producerLot);
    try {
      const source = await getCompany(h, sourceId); assert.equal(source.onHandQuantity, '2'); assert.equal(source.availableQuantity, '2'); assert.equal(source.eligibleQuantity, '0'); assert.ok(source.blockers.includes('ANCESTOR_HELD'));
      const current = await getExecution(h, a); await denied(h, `${path(a)}/reservations`, reserveCompanyBody(current, source, source.units, f.componentItem._id), 409, 'STOCK_ENCUMBERED');
    } finally { assert.equal((await releaseRaw(activeHold)).status, 200); }
    const raw = await h.db.collection('warehouseReceipts').findOne({ _id: f.producerSerial._id });
    await replaceWhile(h, 'warehouseReceipts', raw, { ...raw, hold: { active: false } }, async () => {
      const source = await getCompany(h, sourceId); assert.equal(source.eligibleQuantity, '0');
      const current = await getExecution(h, a); await denied(h, `${path(a)}/reservations`, reserveCompanyBody(current, source, source.units, f.componentItem._id), 409, 'STOCK_ENCUMBERED');
    });
  });

  await t.test('missing overlay head and self-rehashed opening identity cannot restore stock or pass independent source authority', async () => {
    const head = await h.db.collection('companyStockUseHeads').findOne({ _id: sourceId });
    await h.db.collection('companyStockUseHeads').deleteOne({ _id: sourceId });
    try { await denied(h, sourcePath, undefined, 409, 'COMPANY_STOCK_SOURCE_INVALID'); }
    finally { await h.db.collection('companyStockUseHeads').insertOne(head); }
    await replaceWhile(h, 'companyStockUseHeads', head, { ...head, hold: { active: false } }, async () => { await denied(h, sourcePath, undefined, 409, 'COMPANY_STOCK_SOURCE_INVALID'); });
    const unit = await h.db.collection('internalCompanyStockUnits').findOne({ executionId: f.producer._id }), forged = { ...stockHashless(unit), outputUnitId: randomUUID() }; forged.contentHash = stockHash(forged);
    await replaceWhile(h, 'internalCompanyStockUnits', unit, forged, async () => { await denied(h, sourcePath, undefined, 409, 'INTERNAL_EXECUTION_SOURCE_INVALID'); });
    const registry = await h.db.collection('warehouseSerials').findOne({ serial: unit.serial });
    await replaceWhile(h, 'warehouseSerials', registry, { ...registry, workOrderId: null }, async () => { await denied(h, sourcePath, undefined, 409, 'INTERNAL_EXECUTION_SOURCE_INVALID'); });
  });

  await t.test('mixed reservation rollback restores all hidden fences and the same failed key succeeds exactly once after repair', async () => {
    main = await makeConsumer(h, f);
    const source = await getCompany(h, sourceId), body = reserveCompanyBody(main, source, source.units, f.componentItem._id), before = await producerEvidence(h, f);
    await h.db.command({ collMod: 'internalExecutionOutbox', validator: { $jsonSchema: { required: ['QA_REQUIRED_FAULT'] } }, validationLevel: 'strict', validationAction: 'error' });
    try { await denied(h, `${path(main)}/reservations`, body, 500, 'INTERNAL_ERROR'); }
    finally { await h.db.command({ collMod: 'internalExecutionOutbox', validator: {} }); }
    main = await h.ok(`${path(main)}/reservations`, body);
    assert.equal(await h.db.collection('companyMaterialReservations').countDocuments({ executionId: main._id }), 1);
    const committed = await snapshot(h); assert.deepEqual(await h.ok(`${path(main)}/reservations`, body), main); assert.deepEqual(await snapshot(h), committed);
    main = await reserveDirectLot(h, f, main); assert.equal(main.canRelease, true);
    assertProducerConserved(await producerEvidence(h, f), before);
  });

  await t.test('release issue and first operation consume exact company identities once without consuming embodied raw stock again', async () => {
    const before = await producerEvidence(h, f);
    main = await h.ok(`${path(main)}/release`, update(main));
    acknowledgedIssue = update(main); main = await h.ok(`${path(main)}/issue`, acknowledgedIssue);
    let source = await getCompany(h, sourceId); assert.equal(source.onHandQuantity, '2'); assert.equal(source.issuedQuantity, '2'); assert.equal(source.consumedQuantity, '0');
    main = await h.ok(`${path(main)}/records`, update(main, { operationIndex: 0, inputQuantity: '2', goodQuantity: '1', scrapQuantity: '1', laborMinutes: '1.5', machineMinutes: '0', evidence: 'Independent actual one component-equivalent process scrap' }));
    source = await getCompany(h, sourceId); assert.equal(source.onHandQuantity, '0'); assert.equal(source.issuedQuantity, '0'); assert.equal(source.consumedQuantity, '2'); assert.equal(source.units.filter(unit => unit.status === 'CONSUMED').length, 2);
    const consumptions = await h.db.collection('companyMaterialConsumptions').find({ executionId: main._id }).toArray(); assert.equal(consumptions.length, 1); assert.equal(consumptions[0].quantity, '2');
    assert.deepEqual([...consumptions[0].companyUnitIds].sort(), f.producer.companyStock.units.map(unit => unit._id).sort());
    main = await h.ok(`${path(main)}/records`, update(main, { operationIndex: 1, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', laborMinutes: '1', machineMinutes: '0', evidence: 'Independent actual terminal leaf output', outputSerials: [`${f.prefix}_LEAF`] }));
    assert.deepEqual(await h.db.collection('companyMaterialConsumptions').find({ executionId: main._id }).toArray(), consumptions);
    assertProducerConserved(await producerEvidence(h, f), before);
    const direct = await h.ok(`/catalog-stock/receipts/${f.consumerLot._id}`); assert.equal(direct.consumedQuantity, '2.5'); assert.equal(direct.onHandQuantity, '0');
  });

  await t.test('explicit per-output source and process loss reconcile independently before a terminal accepted leaf can enter storage', async () => {
    const companyUnits = f.producer.companyStock.units.map(unit => unit._id).sort(), output = main.outputUnits[0], source = unitIds => [{ sourceKind: 'COMPANY_OUTPUT', companyReceiptId: sourceId, quantity: '1', companyUnitIds: unitIds }, { sourceKind: 'CATALOG_RECEIPT', receiptId: f.consumerLot._id, quantity: '1.25' }];
    await denied(h, `${path(main)}/qc`, update(main, { acceptedSerials: [output.serial], rejectedSerials: [], evidence: 'Unattributed typed inputs must not pass inspection' }), 409, 'PROVENANCE_INCOMPLETE');
    main = await h.ok(`${path(main)}/allocations`, update(main, { outputUnitId: output._id, sources: source([companyUnits[0]]) }));
    await denied(h, `${path(main)}/qc`, update(main, { acceptedSerials: [output.serial], rejectedSerials: [], evidence: 'Missing process loss must not pass inspection' }), 409, 'PROVENANCE_INCOMPLETE');
    main = await h.ok(`${path(main)}/losses`, update(main, { sources: source([companyUnits[1]]) }));
    main = await h.ok(`${path(main)}/qc`, update(main, { acceptedSerials: [output.serial], rejectedSerials: [], evidence: 'Independent exact mixed one-output and one-loss partition' }));
    main = await h.ok(`${path(main)}/putaway`, update(main, { locationId: f.location._id, expectedLocationVersion: f.location.version }));
    const leaf = await getCompany(h, main.companyStock._id);
    assert.equal(leaf.sourcePolicy, 'LEAF_ONLY'); assert.equal(leaf.onHandQuantity, '1'); assert.equal(leaf.blockedQuantity, '1'); assert.equal(leaf.availableQuantity, '0'); assert.equal(leaf.eligibleQuantity, '0'); assert.equal(leaf.canReserve, false); assert.equal(leaf.canDispatch, false); assert.equal(leaf.valuation, 'UNVALUED');
    assert.deepEqual(main.companyStock.consumedReceiptIds, [f.consumerLot._id]);
    assert.deepEqual(main.companyStock.consumedAncestryReceiptIds, [f.consumerLot._id, f.producerLot._id, f.producerSerial._id].sort());
    assert.equal(main.companyStock.consumedAncestryReceiptIds.includes(f.abandoned._id), false);
  });

  await t.test('terminal descendants cannot be relabeled for another generation or forced through customer shipment', async () => {
    const leaf = await getCompany(h, main.companyStock._id), next = await makeConsumer(h, { ...f, leafItem: f.componentItem }, { sourceItem: f.leafItem });
    const body = reserveCompanyBody(next, leaf, leaf.units, f.leafItem._id);
    await denied(h, `${path(next)}/reservations`, body, 409, 'COMPANY_SOURCE_TERMINAL');
    const opening = await h.db.collection('internalCompanyStockReceipts').findOne({ _id: leaf._id });
    assert.equal(opening.sourcePolicy, 'LEAF_ONLY');
    const stripped = { ...stockHashless(opening) }; delete stripped.sourcePolicy; stripped.contentHash = stockHash(stripped);
    await replaceWhile(h, 'internalCompanyStockReceipts', opening, stripped, async () => { await denied(h, `/company-stock/receipts/${leaf._id}`, undefined, 409, 'INTERNAL_EXECUTION_SOURCE_INVALID'); });
    await denied(h, '/fulfillment/shipments', { salesOrderId: randomUUID(), expectedVersion: 1, lineIndex: 0, uom: 'UN', reference: 'Independent forbidden company source shipment', sources: [{ sourceType: 'COMPANY_OUTPUT', sourceId: leaf._id, quantity: '1', serials: leaf.units.map(unit => unit.serial) }], idempotencyKey: randomUUID() }, 400, 'INVALID_SOURCE');
  });

  await t.test('real producer engineering withdrawal blocks new reserve issue and record while preserving history and authorized exact replay', async () => {
    assert.deepEqual(await warehouseMovements(), originalMovements, 'component consumption must not post another raw warehouse movement');
    const second = await makeFixture(h, { acceptedCount: 3 }), receiptId = second.producer.companyStock._id;
    const secondSetupMovements = await warehouseMovements();
    let waitingIssue = await makeConsumer(h, second, { quantity: '1' }), waitingRecord = await makeConsumer(h, second, { quantity: '1' });
    for (const execution of [waitingIssue, waitingRecord]) {
      let current = execution, source = await getCompany(h, receiptId);
      current = await h.ok(`${path(current)}/reservations`, reserveCompanyBody(current, source, [source.units.find(unit => unit.status === 'AVAILABLE')], second.componentItem._id));
      current = await reserveDirectLot(h, second, current, '1.25');
      current = await h.ok(`${path(current)}/release`, update(current));
      if (execution._id === waitingIssue._id) waitingIssue = current;
      else waitingRecord = current;
    }
    const issueBody = update(waitingRecord), issued = await h.ok(`${path(waitingRecord)}/issue`, issueBody);
    waitingRecord = issued;
    const prospective = await makeConsumer(h, second, { quantity: '1' }), beforeStock = await getCompany(h, receiptId);
    assert.equal(beforeStock.availableQuantity, '1'); assert.equal(beforeStock.eligibleQuantity, '1');
    const plan = await h.ok(`/internal-production/orders/${second.producer.internalOrderId}`);
    await h.ok(`/internal-production/orders/${plan._id}/engineering/revoke`, command({ expectedVersion: plan.version, revision: plan.engineering.currentRevision }));
    const blocked = await getCompany(h, receiptId);
    assert.equal(blocked.onHandQuantity, '3'); assert.equal(blocked.availableQuantity, '1'); assert.equal(blocked.eligibleQuantity, '0'); assert.ok(blocked.blockers.includes('PRODUCER_DEMAND_CHANGED'));
    await denied(h, `${path(prospective)}/reservations`, reserveCompanyBody(prospective, blocked, blocked.units.filter(unit => unit.status === 'AVAILABLE'), second.componentItem._id), 409, 'COMPANY_DEPENDENCY_CHANGED');
    await denied(h, `${path(waitingIssue)}/issue`, update(waitingIssue), 409, 'COMPANY_DEPENDENCY_CHANGED');
    await denied(h, `${path(waitingRecord)}/records`, update(waitingRecord, { operationIndex: 0, inputQuantity: '1', goodQuantity: '1', scrapQuantity: '0', laborMinutes: '1', machineMinutes: '0', evidence: 'Withdrawn producer must block dependent actual progress' }), 409, 'COMPANY_DEPENDENCY_CHANGED');
    const beforeReplay = await snapshot(h); assert.deepEqual(await h.ok(`${path(waitingRecord)}/issue`, issueBody), issued); assert.deepEqual(await snapshot(h), beforeReplay);
    const identity = h.seeded.find(row => row.username === 'alpha.owner'), member = await h.db.collection('memberships').findOne({ _id: identity.membershipId });
    await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: ['internalExecutionIssue', 'companyStockReader'].map(role => ({ role, plantIds: member.plantIds })) } });
    try {
      assert.equal(Object.hasOwn(issueBody, 'sourceKind'), false);
      const head = await h.db.collection('internalExecutions').findOne({ _id: waitingRecord._id });
      const receipt = await h.db.collection('internalExecutionKeys').findOne({ key: issueBody.idempotencyKey });
      assert.equal(head.schema, 'INTERNAL_EXECUTION_V2'); assert.equal(receipt.result.schema, 'INTERNAL_EXECUTION_V2');
      await denied(h, `${path(waitingRecord)}/issue`, issueBody, 403, 'SCOPE_DENIED');
      await h.db.collection('internalExecutions').deleteOne({ _id: head._id });
      try { await denied(h, `${path(waitingRecord)}/issue`, issueBody, 403, 'SCOPE_DENIED'); }
      finally { await h.db.collection('internalExecutions').insertOne(head); }
      await replaceWhile(h, 'internalExecutions', head, { ...head, schema: 'INTERNAL_EXECUTION_V1' }, async () => {
        await denied(h, `${path(waitingRecord)}/issue`, issueBody, 403, 'SCOPE_DENIED');
      });
    }
    finally { await h.db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
    assert.equal((await h.ok(`${executionRoot}/${second.producer._id}`)).status, 'STORED');
    assert.deepEqual(await warehouseMovements(), secondSetupMovements);
  });

  async function dependencyFixture() {
    const fixture = await makeFixture(h), receiptId = fixture.producer.companyStock._id;
    const bin = await h.ok('/warehouse/bins', { expectedVersion: 1, code: `${fixture.prefix}_CONSUMER_BIN`, idempotencyKey: randomUUID() }, 201);
    const draft = await h.ok('/inventory-master/locations', command({ code: `${fixture.prefix}_CONSUMER_LOC`, binId: bin._id }), 201);
    const location = await h.ok(`/inventory-master/locations/${draft._id}/qualify`, command({ expectedVersion: draft.version }));
    async function consumer() {
      const plan = await h.ok('/internal-production/orders', command({ schema: 'INTERNAL_PLAN_V2', itemId: fixture.leafItem._id, itemRevision: fixture.leafItem.currentRevision, expectedItemVersion: fixture.leafItem.version, locationId: location._id, expectedLocationVersion: location.version, quantity: '1' }), 201);
      let engineering = await h.ok(`/internal-production/orders/${plan._id}/engineering/revisions`, command({ expectedVersion: plan.version, operations: [{ code: 'QA_DEPENDENCY', instruction: 'Independent company-source dependency check' }], materials: [{ itemId: fixture.componentItem._id, itemRevision: fixture.componentItem.currentRevision, expectedItemVersion: fixture.componentItem.version, quantityPerUnit: '1', uom: fixture.componentItem.content.uom }] }));
      engineering = await h.ok(`/internal-production/orders/${plan._id}/engineering/approve`, command({ expectedVersion: engineering.version, revision: 1 }));
      const execution = await h.ok(executionRoot, command({ internalOrderId: plan._id, expectedOrderVersion: engineering.version, engineeringRevision: 1 }), 201);
      assert.equal(execution.schema, 'INTERNAL_EXECUTION_V2'); assert.equal(execution.materials.length, 1); assert.equal(execution.materials[0].sourceKind, 'COMPANY_OUTPUT');
      return execution;
    }
    let waitingIssue = await consumer();
    const prospective = await consumer(), source = await getCompany(h, receiptId);
    waitingIssue = await h.ok(`${path(waitingIssue)}/reservations`, reserveCompanyBody(waitingIssue, source, [source.units[0]], fixture.componentItem._id));
    waitingIssue = await h.ok(`${path(waitingIssue)}/release`, update(waitingIssue));
    assert.equal(waitingIssue.canIssue, true);
    const physical = await producerEvidence(h, fixture), movements = await warehouseMovements();
    const blocked = async (blocker, errorCode) => {
      const current = await getCompany(h, receiptId);
      assert.equal(current.onHandQuantity, '2'); assert.equal(current.reservedQuantity, '1'); assert.equal(current.availableQuantity, '1'); assert.equal(current.eligibleQuantity, '0'); assert.equal(current.canReserve, false); assert.ok(current.blockers.includes(blocker));
      await denied(h, `${path(prospective)}/reservations`, reserveCompanyBody(prospective, current, current.units.filter(unit => unit.status === 'AVAILABLE'), fixture.componentItem._id), 409, errorCode);
      await denied(h, `${path(waitingIssue)}/issue`, update(waitingIssue), 409, errorCode);
      assert.equal((await getExecution(h, waitingIssue)).canIssue, false);
      assertProducerConserved(await producerEvidence(h, fixture), physical);
      assert.deepEqual(await warehouseMovements(), movements);
    };
    return { fixture, receiptId, waitingIssue, blocked };
  }

  await t.test('actual new producer item revision withdraws old stock eligibility even when the replacement revision is approved', async () => {
    const { fixture, receiptId, blocked } = await dependencyFixture();
    const before = await h.ok(`/inventory-master/items/${fixture.componentItem._id}`);
    const revised = await h.ok(`/inventory-master/items/${before._id}/revisions`, command({ expectedVersion: before.version, ...before.content, description: `${fixture.prefix} actual revised component specification` }));
    assert.equal(revised.status, 'DRAFT'); assert.equal(revised.currentRevision, 2);
    await blocked('ITEM_CHANGED', 'INTERNAL_DEMAND_CHANGED');
    const approved = await h.ok(`/inventory-master/items/${revised._id}/approve`, command({ expectedVersion: revised.version, revision: revised.currentRevision }));
    assert.equal(approved.status, 'APPROVED');
    await blocked('ITEM_CHANGED', 'INTERNAL_DEMAND_CHANGED');
    assert.equal((await getCompany(h, receiptId)).itemRevision, 1);
    // Revision history is retained; the terminal fixture is discarded by owned teardown, not rewound into approval.
  });

  await t.test('restored source-bin deactivation and actual qualified-location withdrawal block source use independently of the consumer location', async () => {
    const { fixture, receiptId, waitingIssue, blocked } = await dependencyFixture();
    const bin = await h.db.collection('warehouseBins').findOne({ _id: fixture.bin._id });
    // There is no mounted bin-deactivation command; only this authority fault uses a restored database replacement.
    await replaceWhile(h, 'warehouseBins', bin, { ...bin, active: false }, async () => {
      await blocked('LOCATION_CHANGED', 'COMPANY_DEPENDENCY_CHANGED');
    });
    const restored = await getCompany(h, receiptId);
    assert.equal(restored.eligibleQuantity, '1'); assert.equal(restored.blockers.includes('LOCATION_CHANGED'), false); assert.equal((await getExecution(h, waitingIssue)).canIssue, true);
    assert.deepEqual(await h.db.collection('warehouseBins').findOne({ _id: bin._id }), bin);
    const location = await h.ok(`/inventory-master/locations/${fixture.location._id}`);
    const inactive = await h.ok(`/inventory-master/locations/${location._id}/deactivate`, command({ expectedVersion: location.version }));
    assert.equal(inactive.status, 'INACTIVE');
    await blocked('LOCATION_CHANGED', 'COMPANY_DEPENDENCY_CHANGED');
    // Location deactivation is terminal by contract; its authentic history remains until owned teardown.
  });
  assert.deepEqual(await forbidden(), forbiddenBefore, 'company component use must not create customer, legacy stock or financial effects');
});
