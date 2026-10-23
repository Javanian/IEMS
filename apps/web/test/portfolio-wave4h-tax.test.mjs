import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { quoteContent } from '../src/features/portfolio/commercial.mjs';
import { monetaryRows } from '../src/features/portfolio/monetary.mjs';

test('VAT journey is additive to all six baseline switches and receives resolved downloads', async () => {
  const harness = await readFile(new URL('./portfolio-browser.mjs', import.meta.url), 'utf8');
  for (const flag of ['PAGINATION', 'REPAIR', 'DOCUMENTS', 'WMS', 'ENGINEERING', 'LABOR', 'VAT']) assert.ok(harness.includes(`process.env.PORTFOLIO_${flag} === '1'`));
  assert.match(harness, /vatJourney\(\{[^\n]*downloadPath: evidence/);
  const journey = await readFile(new URL('./portfolio-wave4h-vat-browser.mjs', import.meta.url), 'utf8');
  for (const proof of ['getDocument', "createHash('sha256')", 'readFile(`${downloadPath}/${filename}`)', "collection('fulfillmentInvoices')", 'documentAudit', 'documentOutbox', 'Input.dispatchKeyEvent']) assert.ok(journey.includes(proof));
});

test('VAT presentation uses invoice-specific authoritative strings, never ambiguous total', () => {
  assert.deepEqual(monetaryRows({ currency: 'USD', taxPolicy: 'FIXTURE_VAT_11_V1', total: '135975.00', netAmount: '73500.00', taxAmount: '8085.00', grossAmount: '81585.00', paidAmount: '10000.00', outstandingAmount: '71585.00' }), [
    ['Subtotal', '73,500.00'], ['Tax', '8,085.00'], ['Total', '81,585.00'], ['Paid', '10,000.00'], ['Balance', '71,585.00'],
  ]);
});
test('legacy NO_TAX does not invent tax while JPY, KWD and large decimals retain exact scale', () => {
  assert.deepEqual(monetaryRows({currency:'JPY', taxPolicy:'NO_TAX', total:'9999999999999999999999999999'}), [['Total','9,999,999,999,999,999,999,999,999,999']]);
  assert.deepEqual(monetaryRows({currency:'KWD', taxPolicy:'FIXTURE_VAT_11_V1', netAmount:'1.000', taxAmount:'0.110', grossAmount:'1.110'}), [['Subtotal','1.000'],['Tax','0.110'],['Total','1.110']]);
});
test('incomplete VAT and unknown policies fail closed instead of presenting a NO_TAX total', () => {
  assert.throws(() => monetaryRows({currency:'USD',taxPolicy:'FIXTURE_VAT_11_V1',total:'1.00'}), /Incomplete/);
  assert.throws(() => monetaryRows({currency:'USD',taxPolicy:'UNKNOWN',total:'1.00'}), /Unsupported/);
});

test('selected fixture policy is sent unchanged without caller tax amounts', () => {
  const content = quoteContent({ taxPolicy: 'FIXTURE_VAT_11_V1', quantity0: '10', unitPrice0: '12250.00', currency0: 'USD' }, 1);
  assert.equal(content.taxPolicy, 'FIXTURE_VAT_11_V1');
  assert.equal(content.lines[0].unitPrice, '12250.00');
  assert.equal('taxAmount' in content, false);
});

test('quote form offers explicit fixture policy and revision default with no rate override', async () => {
  const source = await readFile(new URL('../src/features/portfolio/CommercialWorkspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /name="taxPolicy"/);
  assert.match(source, /defaultValue=\{latest\?\.taxPolicy \|\| 'NO_TAX'\}/);
  assert.match(source, /FIXTURE_VAT_11_V1/);
  assert.doesNotMatch(source, /name="taxRate"/);
});
