import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createSnapshot, renderPdf } from '../src/index.mjs';

test('approved purchase request content produces distinct immutable deterministic PDF', async () => {
  const scope = { tenantId: 'tenant-a', legalEntityId: 'entity-a', plantId: 'plant-a' };
  const source = { _id: 'request-a', ...scope, version: 1, snapshot: { currency: 'USD', total: '0.03', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Requested seal', quantity: '1.5', uom: 'EA', unitPrice: '0.02', currency: 'USD' }] } };
  const request = createSnapshot('purchaseRequest', scope, source);
  assert.notEqual(request.contentHash, createSnapshot('purchaseOrder', scope, source).contentHash);
  source.snapshot.total = '9.00';
  assert.equal(request.total, '0.03');
  assert.ok(Object.isFrozen(request.lines[0]));
  const bytes = await renderPdf(request);
  assert.deepEqual(bytes, await renderPdf(request));
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  try {
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    for (const expected of ['PURCHASE REQUEST', 'Requested seal', '0.03', 'USD']) assert.ok(text.includes(expected), expected);
  } finally { await pdf.destroy(); }
  await assert.rejects(renderPdf({ ...request, total: '9.00' }), /SNAPSHOT_INTEGRITY/);
});
