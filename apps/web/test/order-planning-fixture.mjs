import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const fixedId = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const units = value => { const [a, b = ''] = value.split('.'); return BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0')); };
const decimal = value => `${value / 1000000n}.${String(value % 1000000n).padStart(6, '0')}`.replace(/\.?0+$/, '');

export async function orderPlanningFixture({ db, identities, request }) {
  const orders = {};
  for (const name of ['filler', 'later', 'spread', 'empty', 'operator', 'beta']) {
    const username = name === 'beta' ? 'beta.owner' : 'alpha.owner';
    const account = await request(username, '/api/crm/accounts', { name: `Synthetic planning ${name}` });
    let quote = await request(username, '/api/commercial/quotes', {
      accountId: account._id, expiresAt: '2099-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP',
      lines: [{ description: `Synthetic planning ${name}`, quantity: '500.000', uom: 'EA', unitPrice: '1.00', currency: 'USD' }],
    });
    for (const action of ['approve', 'accept']) quote = await request(username, `/api/commercial/quotes/${quote._id}/${action}`, { expectedVersion: quote.version, revision: 1 });
    orders[name] = await request(username, `/api/commercial/quotes/${quote._id}/convert`, { expectedVersion: quote.version, revision: 1, idempotencyKey: randomUUID() });
    assert.equal(orders[name].status, 'OPEN');
  }
  // Supplemental read fixture, not an operator action: retain the production persisted WO shape and allocation invariant.
  const now = new Date('2026-10-29T00:00:00.000Z');
  const rows = Array.from({ length: 221 }, (_, index) => {
    const rank = index + 1, name = rank === 101 ? 'later' : [102, 201, 221].includes(rank) ? 'spread' : 'filler';
    const so = orders[name], actor = identities.find(x => x.username === 'alpha.owner');
    const quantity = name === 'later' ? '7.125' : rank === 102 ? '0.125' : rank === 201 ? '2.5' : rank === 221 ? '0.375' : '0.001';
    return { _id: fixedId(rank), tenantId: so.tenantId, plantId: so.plantId, version: 1, createdBy: actor.userId, createdAt: now,
      splitId: fixedId(1000 + rank), salesOrderId: so._id, salesOrderVersion: so.version, accountId: so.accountId,
      lineIndex: 0, sourceLine: so.snapshot.lines[0], quantity, uom: 'EA', status: 'PLANNED', executionMode: 'OPERATOR_RECORDED', records: [] };
  });
  const beta = orders.beta, betaActor = identities.find(x => x.username === 'beta.owner');
  rows.push({ ...rows[0], _id: fixedId(9000), tenantId: beta.tenantId, plantId: beta.plantId, salesOrderId: beta._id, salesOrderVersion: beta.version,
    accountId: beta.accountId, sourceLine: beta.snapshot.lines[0], createdBy: betaActor.userId, splitId: fixedId(9001) });
  await db.collection('manufacturingWorkOrders').insertMany(rows);
  for (const so of Object.values(orders)) {
    const children = rows.filter(x => x.salesOrderId === so._id);
    if (!children.length) continue;
    const quantity = decimal(children.reduce((sum, x) => sum + units(x.quantity), 0n));
    assert.ok(units(quantity) <= units(so.snapshot.lines[0].quantity));
    await db.collection('manufacturingAllocated').insertOne({ _id: randomUUID(), tenantId: so.tenantId, plantId: so.plantId,
      version: 1, createdAt: now, createdBy: children[0].createdBy, salesOrderId: so._id, lineIndex: 0, quantity });
  }
  const persisted = await db.collection('manufacturingWorkOrders').find({}).toArray();
  assert.equal(persisted.length, 222);
  for (const wo of persisted) {
    const so = await db.collection('salesOrders').findOne({ _id: wo.salesOrderId });
    assert.deepEqual([wo.tenantId, wo.plantId, wo.accountId, wo.salesOrderVersion, wo.sourceLine, wo.uom, wo.status, wo.records],
      [so.tenantId, so.plantId, so.accountId, so.version, so.snapshot.lines[wo.lineIndex], so.snapshot.lines[wo.lineIndex].uom, 'PLANNED', []]);
  }
  return { orders, fixtureCount: persisted.length, setup: 'Official seed + HTTP commercial lifecycle; supplemental deterministic PLANNED read rows and reconciled allocation inserted directly, not native operator writes.' };
}
