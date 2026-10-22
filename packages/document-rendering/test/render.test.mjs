import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const api = await import('../src/index.mjs').catch(() => ({}));
export const scope = { tenantId: 'tenant-a', legalEntityId: 'entity-a', plantId: 'plant-a' };
export function source(overrides = {}) { return { _id: 'quote-1', ...scope, version: 1, snapshot: { currency: 'USD', total: '0.03', taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Precision seal', quantity: '1.5', uom: 'EA', unitPrice: '0.02', currency: 'USD' }] }, ...overrides }; }
export async function textOf(bytes) { const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise; let text = ''; for (let i=1;i<=pdf.numPages;i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ')+'\n'; const pages = pdf.numPages; await pdf.destroy(); return { text, pages }; }
test('immutable quote snapshot renders a real deterministic PDF with exact quantity price total and scope', async () => {
  assert.equal(typeof api.createSnapshot, 'function');
  const raw = source(); const snapshot = api.createSnapshot('quote', scope, raw);
  raw.snapshot.lines[0].description = 'changed';
  assert.ok(Object.isFrozen(snapshot.lines[0])); assert.equal(snapshot.lines[0].description, 'Precision seal');
  const first = await api.renderPdf(snapshot), second = await api.renderPdf(snapshot);
  assert.deepEqual(first, second); assert.equal(first.subarray(0,5).toString(), '%PDF-');
  const { text, pages } = await textOf(first); assert.equal(pages, 1);
  for (const expected of ['QUOTE', 'Precision seal','1.5','EA','0.02','0.03','USD','tenant-a','plant-a','entity-a']) assert.ok(text.includes(expected), expected);
  const dir = new URL('../evidence/wave3/c-20261022-01/', import.meta.url); await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(new URL('quote.pdf',dir), first);
  await fs.writeFile(new URL('quote-parsed.json',dir),JSON.stringify({pages,text,pdfHash:createHash('sha256').update(first).digest('hex')},null,2));
});
