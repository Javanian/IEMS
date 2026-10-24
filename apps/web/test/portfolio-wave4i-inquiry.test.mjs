import test from 'node:test';
import assert from 'node:assert/strict';
import * as inquiry from '../src/features/portfolio/inquiry.mjs';
import { readFile } from 'node:fs/promises';

test('inquiry browser journey is additive to all six switches and VAT, with the real DB harness', async () => {
  const entry = await readFile(new URL('./portfolio-browser.mjs', import.meta.url), 'utf8');
  for (const flag of ['PAGINATION', 'REPAIR', 'DOCUMENTS', 'WMS', 'ENGINEERING', 'LABOR', 'VAT', 'INQUIRY']) assert.ok(entry.includes(`process.env.PORTFOLIO_${flag} === '1'`), flag);
  assert.match(entry, /await inquiryJourney\(\{ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse, downloadPath: evidence \}\)/);
});

test('sourced quote revision preserves frozen fields while permitting only commercial changes', () => {
  const line = { provenance: { inquiryId: 'inquiry-1', inquiryRevision: 2, inquiryLineId: 'line-1', itemCode: 'PART-A', drawingNumber: 'DWG-A', drawingRevision: 'B' }, description: 'Exact source', quantity: '2.500', uom: 'EA', unitPrice: '10.00', currency: 'USD', amount: '25.00' };
  assert.deepEqual(inquiry.sourcedQuoteContent({ expiresAt: '2027-01-01T00:00:00.000Z', unitPrice0: '11.00', currency0: 'USD', quantity0: '999' }, { lines: [line] }), { expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ provenance: line.provenance, description: 'Exact source', quantity: '2.500', uom: 'EA', unitPrice: '11.00', currency: 'USD' }] });
});

test('provider provenance and stage history render from documented envelopes', async () => {
  const lineage = await readFile(new URL('../src/features/portfolio/SourceLineage.jsx', import.meta.url), 'utf8');
  const commercial = await readFile(new URL('../src/features/portfolio/CommercialWorkspace.jsx', import.meta.url), 'utf8');
  const workspace = await readFile(new URL('../src/features/portfolio/InquiryWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(lineage, /source\?\.provenance/);
  assert.match(commercial, /line\.provenance\?\.inquiryId/);
  for (const field of ['from', 'to', 'actorId', 'occurredAt']) assert.ok(workspace.includes(`entry.${field}`), field);
});

test('inquiry capabilities reuse the actual quote write grant', () => {
  assert.equal(inquiry.inquiryPermission('inquiry.write'), 'quote.write');
  assert.equal(inquiry.inquiryPermission('inquiry.transition'), 'quote.write');
  assert.equal(inquiry.inquiryPermission('inquiry.convert'), 'quote.write');
  assert.equal(inquiry.inquiryPermission('quote.write'), 'quote.write');
});

test('inquiry source retains exact strings and existing stable line IDs without accepting money', () => {
  const values = { itemCode0: 'PART-A', description0: ' Exact part ', quantity0: '1.250000', uom0: 'EA', drawingNumber0: 'DWG-A', drawingRevision0: 'B', unitPrice0: '99.99' };
  assert.deepEqual(inquiry.inquiryLines(values, 1, [{ lineId: 'stable-id' }]), [{ lineId: 'stable-id', itemCode: 'PART-A', description: ' Exact part ', quantity: '1.250000', uom: 'EA', drawingNumber: 'DWG-A', drawingRevision: 'B' }]);
});

test('inquiry conversion sends only commercial prices and the selected immutable revision', () => {
  const source = { version: 4, revisions: [{ number: 1, lines: [{ lineId: 'a', itemCode: 'LOCKED', quantity: '2.500' }, { lineId: 'b' }] }] };
  const values = { expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'NO_TAX', unitPrice0: '1234567890123456789012345678.99', currency0: 'USD', unitPrice1: '0.01', currency1: 'USD', quantity0: '999', itemCode0: 'TAMPER' };
  assert.deepEqual(inquiry.inquiryConversion(source, values, 'same-key'), { expectedVersion: 4, revision: 1, expiresAt: values.expiresAt, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', prices: [{ inquiryLineId: 'a', unitPrice: values.unitPrice0, currency: 'USD' }, { inquiryLineId: 'b', unitPrice: '0.01', currency: 'USD' }], idempotencyKey: 'same-key' });
});
