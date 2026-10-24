import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startOwned, orderWithStock } from './support/owned-mongo.mjs';

const command = body => ({ expectedVersion: 1, idempotencyKey: randomUUID(), ...body });
const holds = [{ held: true }, { hold: { active: true } }, { heldQuantity: '0.000001' }];

test('manufacturing held-stock eligibility on owned real Mongo HTTP', async t => {
  const h = await startOwned(t), { db, ok } = h;
  const names = ['engineeringPackages', 'engineeringRevisions', 'manufacturingWorkOrders', 'warehouseReceipts', 'warehouseReservations', 'manufacturingMovements', 'manufacturingKeys', 'manufacturingAudit', 'manufacturingOutbox'];
  const snapshot = () => Promise.all(names.map(n => db.collection(n).find().sort({ _id: 1 }).toArray()));
  const setup = async (engineering, extraMaterial = false) => {
    const f = await orderWithStock(h, { orderQuantity: '2', receiptQuantity: '20', reserve: null });
    const materials = [{ receiptId: f.receipt._id, quantityPerUnit: '2.000', uom: 'KG' }];
    if (extraMaterial) {
      const second = await orderWithStock(h, { receiptQuantity: '10', reserve: null });
      materials.push({ receiptId: second.receipt._id, quantityPerUnit: '1.000', uom: 'KG' });
    }
    const content = { operations: [{ code: 'MAKE', instruction: 'Measured synthetic operation' }], materials };
    const wo = (await ok('/manufacturing/work-orders', command({ salesOrderId: f.so._id, lineIndex: 0, quantities: ['1'], uom: 'KG' }), 201)).workOrders[0];
    let release = command(content);
    if (engineering) {
      let head = await ok('/manufacturing/engineering', command({ ...content, salesOrderId: f.so._id, salesOrderVersion: f.so.version, lineIndex: 0, uom: 'KG' }), 201);
      head = await ok(`/manufacturing/engineering/${head._id}/release`, command({ revision: 1 }));
      release = command({ engineeringId: head._id, engineeringVersion: head.version, revision: 1 });
    }
    const path = `/manufacturing/work-orders/${wo._id}`;
    return { ...f, materials, path, releasePath: `${path}/${engineering ? 'release-engineering' : 'release'}`, release,
      record: command({ expectedVersion: 2, operationIndex: 0, inputQuantity: '1', goodQuantity: '0.750000', scrapQuantity: '0.250000', uom: 'KG', evidence: 'Measured synthetic output' }) };
  };
  const hold = (receiptId, patch) => db.collection('warehouseReceipts').updateOne({ _id: receiptId }, { $set: patch });
  const denied = async (path, body) => {
    const before = await snapshot();
    const response = await h.req(path, body, h.alpha);
    assert.equal(response.status, 409, JSON.stringify(response));
    assert.equal(response.error.code, 'STOCK_ENCUMBERED');
    assert.deepEqual(await snapshot(), before);
  };

  for (const engineering of [false, true]) for (const patch of holds) {
    await t.test(`${engineering ? 'engineering' : 'legacy'} reserve refuses ${JSON.stringify(patch)} without durable effects`, async () => {
      const f = await setup(engineering);
      // No public hold API: only the marked disposable Mongo fixture is changed.
      await hold(f.receipt._id, patch);
      await denied(f.releasePath, f.release);
      await denied(f.releasePath, f.release);
    });
    await t.test(`${engineering ? 'engineering' : 'legacy'} hold after reserve preserves frozen snapshot and reservation ${JSON.stringify(patch)}`, async () => {
      const f = await setup(engineering);
      const released = await ok(f.releasePath, f.release);
      if (engineering) assert.equal(released.engineeringSnapshot.releaseSnapshot.materials[0].quantityPerUnit, '2.000');
      await hold(f.receipt._id, patch);
      const before = await snapshot();
      assert.deepEqual(await ok(f.releasePath, f.release), released);
      assert.deepEqual(await snapshot(), before);
      await denied(`${f.path}/record`, f.record);
      const receipt = await db.collection('warehouseReceipts').findOne({ _id: f.receipt._id });
      assert.equal(receipt.availableQuantity, '18');
      assert.equal(receipt.manufacturingReservedQuantity, '2');
      assert.equal(receipt.manufacturingConsumedQuantity || '0', '0');
      assert.deepEqual(await ok(f.path), released);
    });
  }

  await t.test('held denials and historical replay retain scope and fresh role authorization', async () => {
    const f = await setup(true);
    const released = await ok(f.releasePath, f.release);
    await hold(f.receipt._id, holds[0]);
    const before = await snapshot();
    for (const [path, body] of [[f.releasePath, f.release], [`${f.path}/record`, f.record]]) {
      assert.equal((await h.req(path, body, h.beta)).status, 404);
      assert.equal((await h.req(path, { ...body, tenant_id: h.seeded[1].tenantId }, h.alpha)).status, 403);
      const restore = await h.setRoles(h.seeded[0], ['manufacturingRead']);
      try { assert.equal((await h.req(path, body, h.alpha)).status, 403); } finally { await restore(); }
    }
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await ok(f.releasePath, f.release), released);
    assert.equal((await h.req(f.releasePath, { ...f.release, expectedVersion: 2 }, h.alpha)).error.code, 'IDEMPOTENCY_CONFLICT');
    await denied(`${f.path}/record`, f.record);
  });

  await t.test('later held material rolls back earlier material writes for release and consumption', async () => {
    for (const engineering of [false, true]) {
      const f = await setup(engineering, true);
      await hold(f.materials[1].receiptId, holds[1]);
      await denied(f.releasePath, f.release);
      const g = await setup(engineering, true);
      await ok(g.releasePath, g.release);
      await hold(g.materials[1].receiptId, holds[2]);
      await denied(`${g.path}/record`, g.record);
    }
  });

  await t.test('unheld false and zero markers remain eligible; validator rollback and record races replay once', async () => {
    const f = await setup(true);
    await hold(f.receipt._id, { held: false, hold: { active: false }, heldQuantity: '0.000000' });
    await ok(f.releasePath, f.release);
    for (const name of ['manufacturingMovements', 'manufacturingAudit', 'manufacturingOutbox']) {
      const before = await snapshot();
      await db.command({ collMod: name, validator: { forbidden: { $exists: true } }, validationLevel: 'strict' });
      try {
        assert.equal((await h.req(`${f.path}/record`, f.record, h.alpha)).status, 500);
        assert.deepEqual(await snapshot(), before);
      } finally { await db.command({ collMod: name, validator: {} }); }
    }
    const results = await Promise.all([1, 2, 3].map(() => h.req(`${f.path}/record`, f.record, h.alpha)));
    assert.deepEqual(results.map(r => r.status), [200, 200, 200]);
    assert.deepEqual(results[0].data, results[1].data);
    assert.deepEqual(results[1].data, results[2].data);
    await hold(f.receipt._id, holds[0]);
    const before = await snapshot();
    assert.deepEqual(await ok(`${f.path}/record`, f.record), results[0].data);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await db.collection('manufacturingMovements').countDocuments({ workOrderId: results[0].data._id, kind: 'MATERIAL_CONSUMED' }), 1);
    const rec = await ok(`/warehouse/receipts/${f.receipt._id}/reconciliation`);
    assert.equal(rec.matches, true);
    assert.equal(rec.replayed.manufacturingConsumedQuantity, '2');
  });

  await t.test('distinct keys contend once for release and first consumption', async () => {
    for (const engineering of [false, true]) {
      const f = await setup(engineering);
      const releaseResults = await Promise.all([1, 2].map(() => h.req(f.releasePath, { ...f.release, idempotencyKey: randomUUID() }, h.alpha)));
      assert.deepEqual(releaseResults.map(r => r.status).sort(), [200, 409]);
      const recordResults = await Promise.all([1, 2].map(() => h.req(`${f.path}/record`, { ...f.record, idempotencyKey: randomUUID() }, h.alpha)));
      assert.deepEqual(recordResults.map(r => r.status).sort(), [200, 409]);
      assert.equal(await db.collection('manufacturingMovements').countDocuments({ workOrderId: releaseResults.find(r => r.status === 200).data._id, kind: 'MATERIAL_RESERVED' }), 1);
      assert.equal(await db.collection('manufacturingMovements').countDocuments({ workOrderId: releaseResults.find(r => r.status === 200).data._id, kind: 'MATERIAL_CONSUMED' }), 1);
      assert.equal((await ok(`/warehouse/receipts/${f.receipt._id}/reconciliation`)).matches, true);
    }
  });

  await t.test('hold writes racing reserve or consume serialize on the actual receipt', async () => {
    for (const engineering of [false, true]) for (const consume of [false, true]) {
      const f = await setup(engineering);
      if (consume) await ok(f.releasePath, f.release);
      const path = consume ? `${f.path}/record` : f.releasePath, body = consume ? f.record : f.release;
      const before = await snapshot();
      const [response] = await Promise.all([h.req(path, body, h.alpha), hold(f.receipt._id, holds[0])]);
      assert.ok([200, 409].includes(response.status), JSON.stringify(response));
      if (response.status === 409) {
        assert.equal(response.error.code, 'STOCK_ENCUMBERED');
        const after = await snapshot();
        const receiptRows = after[names.indexOf('warehouseReceipts')];
        delete receiptRows.find(r => r._id === f.receipt._id).held;
        assert.deepEqual(after, before);
      }
      const receipt = await db.collection('warehouseReceipts').findOne({ _id: f.receipt._id });
      assert.equal(receipt.held, true);
      if (!consume && response.status === 200) await denied(`${f.path}/record`, f.record);
      if (response.status === 409) await denied(path, { ...body, idempotencyKey: randomUUID() });
      assert.equal((await ok(`/warehouse/receipts/${f.receipt._id}/reconciliation`)).matches, true);
      console.log('HOLD_RACE', { engineering, consume, status: response.status });
    }
  });
});
