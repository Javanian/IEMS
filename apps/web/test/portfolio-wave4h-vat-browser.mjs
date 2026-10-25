import { waitForTechnicalDetails } from './browser-readiness.mjs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { getDocument } from '../../../packages/document-rendering/node_modules/pdfjs-dist/legacy/build/pdf.mjs';

export async function vatJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, downloadPath }) {
  const api = async (path, body, status = 200) => {
    const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method: body ? 'POST' : 'GET', headers, ...(body && { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result.data;
  };
  const navigate = async path => { await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` }); };
  const triple = row => [row.netAmount, row.taxAmount, row.grossAmount];
  const account = await api('/crm/accounts', { name: 'Synthetic Wave4h VAT customer' }, 201);
  const content = price => ({ expiresAt: '2027-01-01T00:00:00.000Z', taxPolicy: 'FIXTURE_VAT_11_V1', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic Wave4h ten units', quantity: '10', unitPrice: price, currency: 'USD', uom: 'UN' }] });
  await navigate('quotes/new'); await wait('document.querySelector("[name=taxPolicy]")');
  for (const [name, value] of Object.entries({ accountId: account._id, expiresAt: content('').expiresAt, taxPolicy: 'FIXTURE_VAT_11_V1', description0: content('').lines[0].description, quantity0: '10', uom0: 'UN', unitPrice0: '12800.00', currency0: 'USD' })) await fill(name, value);
  await click('Save quote'); await waitForTechnicalDetails({wait,evaluate},'Quote ID:');
  let quote = await db.collection('quotes').findOne({ accountId: account._id });
  assert.deepEqual(triple(quote.revisions[0]), ['128000.00', '14080.00', '142080.00']);
  await click('Approve revision'); await wait('document.body.innerText.includes("Status: Approved")');
  await wait('document.querySelector("[name=taxPolicy]")?.value==="FIXTURE_VAT_11_V1"');
  // Genuine second writer makes the rendered revision form stale.
  await api(`/commercial/quotes/${quote._id}/revisions`, { expectedVersion: 2, ...content('12250.00') });
  for (const [name, value] of Object.entries({ description0: content('').lines[0].description, quantity0: '10', uom0: 'UN', unitPrice0: '12250.00' })) await fill(name, value);
  await click('Save revision'); await waitForTechnicalDetails({wait,evaluate},'VERSION_CONFLICT');
  assert.equal((await db.collection('quotes').findOne({ _id: quote._id })).revisions.length, 2);
  await click('Refresh record'); await wait('document.body.innerText.includes("Revision: 2")');
  await click('Approve revision'); await wait('document.body.innerText.includes("Status: Approved")');
  await click('Record acceptance'); await wait('document.body.innerText.includes("Status: Accepted")');
  await click('Convert to sales order'); await wait('document.querySelector("[data-order-id]")');
  quote = await db.collection('quotes').findOne({ _id: quote._id });
  const order = await db.collection('salesOrders').findOne({ quoteId: quote._id });
  assert.deepEqual(triple(order.snapshot), ['122500.00', '13475.00', '135975.00']);
  assert.deepEqual(triple(quote.approvals[0].snapshot), ['128000.00', '14080.00', '142080.00']);
  assert.equal(order.quoteRevision, 2);
  check('wave4h VAT: native policy selection, stale revision conflict/refresh, immutable R1/R2 history and converted SO exact strings');

  // Use mounted upstream APIs to produce genuine QC sources, never fabricated invoice rows.
  const vendor = await api('/procurement/vendors', { name: 'Synthetic Wave4h materials' }, 201);
  const pr = await api('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic material', quantity: '10', uom: 'KG', unitPrice: '1.00', currency: 'USD' }] }, 201);
  await api(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await api(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: randomUUID() });
  await api(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipt = await api('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '10', uom: 'KG', idempotencyKey: randomUUID() }, 201);
  await api(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic fixture QC release', idempotencyKey: randomUUID() });
  await api(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'Synthetic Wave4h store', idempotencyKey: randomUUID() });
  const plan = await api('/manufacturing/work-orders', { salesOrderId: order._id, expectedVersion: 1, lineIndex: 0, uom: 'UN', quantities: ['6', '4'], idempotencyKey: randomUUID() }, 201);
  const invoices = [];
  for (const wo of plan.workOrders) {
    const path = `/manufacturing/work-orders/${wo._id}`;
    await api(`${path}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Synthetic fixture manufacture' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'KG' }], idempotencyKey: randomUUID() });
    await api(`${path}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: wo.quantity, goodQuantity: wo.quantity, scrapQuantity: '0', uom: 'UN', evidence: 'Synthetic fixture output', idempotencyKey: randomUUID() });
    await api(`${path}/qc`, { expectedVersion: 3, acceptedQuantity: wo.quantity, rejectedQuantity: '0', uom: 'UN', evidence: 'Synthetic fixture QC', idempotencyKey: randomUUID() });
    const shipment = await api('/fulfillment/shipments', { salesOrderId: order._id, expectedVersion: 1, lineIndex: 0, uom: 'UN', sources: [{ sourceType: 'WORK_ORDER', sourceId: wo._id, quantity: wo.quantity }], reference: `Synthetic Wave4h dispatch ${wo.quantity}`, idempotencyKey: randomUUID() }, 201);
    await navigate(`fulfillment/orders/${order._id}`); await wait(`document.querySelector('[name=shipmentId] option[value="${shipment._id}"]')`);
    await fill('shipmentId', shipment._id); await fill('invoiceQuantity', wo.quantity); await click('Issue invoice');
    await wait(`document.querySelector('tbody tr td:last-child')?.textContent===${JSON.stringify(wo.quantity === '6' ? '6 UN' : '10 UN')}`);
    const invoice = await db.collection('fulfillmentInvoices').findOne({ salesOrderId: order._id, 'lines.shipmentId': shipment._id });
    assert.deepEqual(triple(invoice), wo.quantity === '6' ? ['73500.00', '8085.00', '81585.00'] : ['49000.00', '5390.00', '54390.00']);
    invoices.push(invoice);
  }
  await call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath.replaceAll('/', '\\') });
  const artifacts = [];
  for (const [kind, row, revision, path] of [['quote', quote, 1, `quotes/${quote._id}`], ['quote', quote, 2, `quotes/${quote._id}`], ...invoices.map(i => ['invoice', i, 1, `fulfillment/invoices/${i._id}`])]) {
    await navigate(path); await wait(`document.body.innerText.includes('Source ${kind}, revision ${revision}.')`);
    const control = async label => {
      await evaluate(`(()=>{const s=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent==='Immutable issued document'&&s.textContent.includes('Source ${kind}, revision ${revision}.'));const b=[...s.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled);b.focus()})()`);
      assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
      await call('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    };
    await control('Issue immutable PDF'); await wait(`document.body.innerText.includes('Issued artifact loaded')`);
    const intent = await db.collection('documentIntents').findOne({ kind, sourceId: row._id, sourceVersion: revision });
    assert.equal(intent.state, 'READY'); const metadata = await api(`/documents/issues/${intent._id}`);
    assert.equal(intent.record.pdfHash, metadata.pdfHash);
    assert.equal(intent.record.contentHash, metadata.contentHash);
    assert.equal(metadata.snapshot.schemaVersion, 2);
    for (const collection of ['documentAudit', 'documentOutbox']) {
      const event = await db.collection(collection).findOne({ sourceId: row._id, sourceVersion: revision });
      assert.equal(event.pdfHash, metadata.pdfHash);
      assert.equal(event.contentHash, metadata.contentHash);
    }
    await control('Download verified PDF'); const filename = `${kind}-${metadata._id}.pdf`;
    for (let n = 0; n < 100 && !(await readdir(downloadPath)).includes(filename); n++) await new Promise(r => setTimeout(r, 100));
    const bytes = await readFile(`${downloadPath}/${filename}`); assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.pdfHash);
    const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
    let text = ''; for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map(i => i.str).join(' ');
    await pdf.destroy();
    for (const expected of [row._id, ...triple(kind === 'quote' ? quote.revisions[revision - 1] : row)]) assert.ok(text.includes(expected), `PDF missing ${expected}`);
    await writeFile(`${downloadPath}/wave4h-${kind}-${row._id}-${revision}-parsed.txt`, text);
    const time = await evaluate('performance.timeOrigin'); await call('Page.reload'); await wait(`performance.timeOrigin!==${time}&&document.body.innerText.includes('Source ${kind}, revision ${revision}.')`);
    await control('Issue immutable PDF'); await waitForTechnicalDetails({wait,evaluate},metadata.pdfHash);
    for (const width of [375, 768, 1280]) { await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 }); assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false); await screenshot(`wave4h-${kind}-${revision}-${row._id}-${width}`); }
    for (const collection of ['documentIntents', 'documentAudit', 'documentOutbox']) assert.equal(await db.collection(collection).countDocuments({ sourceId: row._id, sourceVersion: revision }), 1);
    artifacts.push({ kind, sourceId: row._id, revision, issueId: metadata._id, pdfHash: metadata.pdfHash, filename });
    check(`wave4h VAT ${kind} ${revision} ${row._id}: keyboard issue/download, actual PDF parser/hash, historical replay uniqueness, mobile widths`);
  }
  for (const invoice of invoices) {
    await navigate(`fulfillment/invoices/${invoice._id}`); await wait('document.querySelector("[name=amount]")');
    const formatted = invoice.grossAmount === '81585.00' ? '81,585.00' : '54,390.00';
    assert.ok(await evaluate(`document.querySelector('.pf-monetary')?.textContent.includes(${JSON.stringify(formatted)})`));
    await fill('amount', invoice.grossAmount); await fill('reference', `Synthetic Wave4h gross ${invoice._id}`); await click('Allocate payment');
    await wait('document.querySelector(".pf-dl dd:last-child")?.textContent==="USD 0.00"');
    const paid = await db.collection('fulfillmentInvoices').findOne({ _id: invoice._id }); assert.deepEqual([paid.paidAmount, paid.outstandingAmount, paid.status], [invoice.grossAmount, '0.00', 'PAID']); assert.deepEqual(triple(paid), triple(invoice));
  }
  await writeFile(`${downloadPath}/wave4h-vat.json`, JSON.stringify(artifacts, null, 2));
  check('wave4h VAT partial 6/4 invoice native controls and gross settlement, independent exact persisted amounts');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
}
