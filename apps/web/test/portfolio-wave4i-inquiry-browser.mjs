import { waitForTechnicalDetails } from './browser-readiness.mjs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { getDocument } from '../../../packages/document-rendering/node_modules/pdfjs-dist/legacy/build/pdf.mjs';

export async function inquiryJourney({ db, call, wait, click, fill, evaluate, screenshot, check, headers, loseResponse, downloadPath }) {
  const api = async (path, body, status = 200) => {
    const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method: body ? 'POST' : 'GET', headers, ...(body && { body: JSON.stringify(body) }) });
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result.data;
  };
  const navigate = async path => { await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}` }); };
  const reload = async predicate => { const before = await evaluate('performance.timeOrigin'); await call('Page.reload'); await wait(`performance.timeOrigin!==${before}&&(${predicate})`); };
  const account = await api('/crm/accounts', { name: 'Synthetic Wave4i inquiry customer' }, 201);
  await click('Inquiries'); await click('Create inquiry');
  await wait(`document.querySelector('[name=accountId] option[value="${account._id}"]')`);
  await fill('accountId', account._id);
  const source = [
    { itemCode: 'SYNTH-I-A', description: 'Synthetic inquiry exact part A', quantity: '10.000000', uom: 'UN', drawingNumber: 'SYNTH-DWG-A', drawingRevision: 'A' },
    { itemCode: 'SYNTH-I-B', description: 'Synthetic inquiry exact part B', quantity: '1.250000', uom: 'EA', drawingNumber: 'SYNTH-DWG-B', drawingRevision: 'B' },
  ];
  await click('Add inquiry line');
  for (const [i, line] of source.entries()) for (const [field, value] of Object.entries(line)) { await wait(`document.querySelector('[aria-label="Save inquiry"] [name="${field}${i}"]:enabled')`); await fill(`${field}${i}`, value); }
  assert.equal(await evaluate('Boolean(document.querySelector("[name=unitPrice0]"))'), false);
  await click('Save inquiry'); await waitForTechnicalDetails({wait,evaluate},'Inquiry ID:');
  const id = await evaluate('location.pathname.split("/").at(-1)');
  let inquiry = await db.collection('inquiries').findOne({ _id: id });
  assert.equal(inquiry.accountId, account._id); assert.equal(inquiry.stage, 'DRAFT');
  const initial = structuredClone(inquiry.revisions[0]);
  for (const [i, line] of initial.lines.entries()) { assert.ok(line.lineId); const { lineId, ...content } = line; assert.deepEqual(content, source[i]); }
  await wait(`document.querySelector('[aria-label="Save inquiry revision"] [name=drawingRevision0]:enabled')`);
  await fill('drawingRevision0', 'C'); await click('Save inquiry revision'); await wait('document.body.innerText.includes("Source revision 2")');
  inquiry = await db.collection('inquiries').findOne({ _id: id });
  assert.deepEqual(inquiry.revisions[0], initial); assert.deepEqual(inquiry.revisions[1].lines.map(l => l.lineId), initial.lines.map(l => l.lineId));
  assert.equal(inquiry.revisions[1].lines[0].drawingRevision, 'C');
  check('wave4i inquiry native multiline create/revision: exact decimal, UOM, drawing metadata, stable line identity, immutable R1, no price input');

  const credential = await db.collection('credentials').findOne({ username: 'alpha.owner' });
  const member = await db.collection('memberships').findOne({ userId: credential._id });
  const beforeDenied = structuredClone(inquiry);
  await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [] } });
  try {
    await click('Refresh record'); await wait('document.querySelector("[role=alert]")?.innerText.includes("Access denied")');
    await reload('document.querySelector("[role=alert]")?.innerText.includes("Access denied")');
    assert.deepEqual(await db.collection('inquiries').findOne({ _id: id }), beforeDenied);
  } finally { await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
  await reload('document.body.innerText.includes("Stage: Draft")&&document.querySelector("[name=reason]")');
  check('wave4i inquiry real membership revocation, denied refresh/hard reload, immutable persisted record and restored session');
  await api(`/commercial/inquiries/${id}/stage`, { expectedVersion: inquiry.version, toStage: 'SUBMITTED', reason: 'Synthetic submit inquiry', idempotencyKey: randomUUID() });
  await fill('reason', 'Stale writer must not commit'); await click('Submit inquiry'); await waitForTechnicalDetails({wait,evaluate},'VERSION_CONFLICT');
  assert.equal((await db.collection('inquiries').findOne({ _id: id })).history.length, 1);
  await click('Refresh record'); await wait('document.body.innerText.includes("Stage: Submitted")&&document.querySelector("[name=reason]:enabled")');
  check('wave4i inquiry genuine stale second writer 409, no duplicate history and explicit current-record recovery');
  assert.equal(await evaluate('Boolean(document.querySelector("[name=quantity0]"))'), false);
  await fill('reason', 'Synthetic review inquiry');
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Start inquiry review');b.focus()})()`);
  assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
  await call('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait('document.body.innerText.includes("Stage: Under review")');
  inquiry = await db.collection('inquiries').findOne({ _id: id }); const frozen = structuredClone(inquiry.revisions);
  assert.deepEqual(inquiry.history.map(h => [h.from, h.to, h.reason]), [['DRAFT', 'SUBMITTED', 'Synthetic submit inquiry'], ['SUBMITTED', 'IN_REVIEW', 'Synthetic review inquiry']]);
  for (const h of inquiry.history) { assert.equal(h.actorId, credential._id); assert.ok(h.occurredAt instanceof Date); }
  await reload('document.body.innerText.includes("Stage: Under review")&&document.querySelector("[name=unitPrice0]")');
  assert.ok(await evaluate('document.body.innerText.includes("Synthetic submit inquiry")&&document.body.innerText.includes("Synthetic review inquiry")'));
  assert.equal(await evaluate('Boolean(document.querySelector("[name=quantity0],[name=itemCode0],[name=drawingNumber0]"))'), false);
  await fill('expiresAt', '2027-01-01T00:00:00.000Z'); await fill('taxPolicy', 'FIXTURE_VAT_11_V1');
  await fill('unitPrice0', '12250.00'); await fill('currency0', 'USD'); await fill('unitPrice1', '10.00'); await fill('currency1', 'USD');
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  try { await click('Convert inquiry to quote'); await wait('document.body.innerText.includes("Retry same request")'); }
  finally { await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
  const effectCounts = async () => Promise.all(['inquiryKeys', 'commercialAudit', 'commercialOutbox'].map(c => db.collection(c).countDocuments({})));
  let committedCounts;
  const loss = await loseResponse(`*/api/commercial/inquiries/${id}/convert`, () => click('Retry same request'), async ({ command }) => {
    const committed = await db.collection('inquiries').findOne({ _id: id });
    assert.equal(committed.stage, 'QUOTED'); assert.ok(committed.quoteId);
    committedCounts = await effectCounts();
    assert.equal(command.expectedVersion, inquiry.version); assert.equal(command.revision, 2);
    assert.equal(await db.collection('quotes').countDocuments({ inquiryId: id }), 1);
  });
  await wait('document.body.innerText.includes("Retry same request")');
  await click('Retry same request'); await wait('document.body.innerText.includes("Stage: Quoted")');
  assert.equal((await api(`/commercial/inquiries/${id}`)).quoteId, (await db.collection('inquiries').findOne({ _id: id })).quoteId);
  assert.ok(loss.command.idempotencyKey);
  assert.deepEqual(await effectCounts(), committedCounts);
  await api(`/commercial/inquiries/${id}/convert`, { ...loss.command, expiresAt: '2027-02-01T00:00:00.000Z' }, 409);
  await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [] } });
  try { await api(`/commercial/inquiries/${id}/convert`, loss.command, 403); }
  finally { await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } }); }
  assert.deepEqual(await effectCounts(), committedCounts);
  check('wave4i committed conversion replay conserves key/audit/outbox counts, changed payload409 and revoked replay403 without effects');
  inquiry = await db.collection('inquiries').findOne({ _id: id }); assert.deepEqual(inquiry.revisions, frozen);
  assert.equal(await db.collection('quotes').countDocuments({ inquiryId: id }), 1);
  let quote = await db.collection('quotes').findOne({ _id: inquiry.quoteId }); assert.ok(quote);
  const provenance = (record, i) => {
    const line = record.provenance;
    const src = frozen.at(-1).lines[i];
    assert.deepEqual([line.inquiryId, line.inquiryRevision, line.inquiryLineId, line.itemCode, line.drawingNumber, line.drawingRevision], [id, 2, src.lineId, src.itemCode, src.drawingNumber, src.drawingRevision]);
  };
  quote.revisions[0].lines.forEach(provenance);
  assert.deepEqual(quote.revisions[0].lines.map(l => l.quantity), ['10.000000', '1.250000']);
  await click('Open converted quote'); await waitForTechnicalDetails({wait,evaluate},'Quote ID:');await wait('document.querySelector("[name=unitPrice0]")');
  assert.equal(await evaluate('Boolean(document.querySelector("[name=quantity0],[name=description0],[name=uom0],[name=drawingRevision0]"))'), false);
  await fill('unitPrice0', '12000.00'); await click('Save commercial revision'); await wait('document.body.innerText.includes("Revision: 2")');
  quote = await db.collection('quotes').findOne({ _id: quote._id }); quote.revisions[1].lines.forEach(provenance);
  assert.equal(quote.revisions[1].lines[0].quantity, '10.000000');
  await click('Approve revision'); await wait('document.body.innerText.includes("Status: Approved")'); await click('Record acceptance'); await wait('document.body.innerText.includes("Status: Accepted")');
  await click('Convert to sales order'); await wait('document.querySelector("[data-order-id]")');
  const orderId = await evaluate('document.querySelector("[data-order-id]").dataset.orderId');
  const order = await db.collection('salesOrders').findOne({ _id: orderId }); order.snapshot.lines.forEach(provenance);
  await click('Open sales order'); await waitForTechnicalDetails({wait,evaluate},'Order ID:');
  await reload(`location.pathname.split('/').at(-1)===${JSON.stringify(orderId)}&&document.body.innerText.includes("SYNTH-DWG-A")`);
  await click('Open source inquiry'); await wait('document.body.innerText.includes("Stage: Quoted")');
  check('wave4i inquiry stage/history hard reload, offline retained-key conversion, single quote, commercial-only revision, approval/SO frozen lineage and native source navigation');
  await screenshot('wave4i-inquiry-quoted');

  // Genuine upstream purchasing and manufacture produce the partial fulfillment source.
  const vendor = await api('/procurement/vendors', { name: 'Synthetic Wave4i material vendor' }, 201);
  const pr = await api('/procurement/requests', { vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: [{ description: 'Synthetic material', quantity: '10', uom: 'KG', unitPrice: '1.00', currency: 'USD' }] }, 201);
  await api(`/procurement/requests/${pr._id}/approve`, { expectedVersion: 1 });
  const po = await api(`/procurement/requests/${pr._id}/convert`, { expectedVersion: 2, idempotencyKey: randomUUID() });
  await api(`/procurement/orders/${po._id}/issue`, { expectedVersion: 1 });
  const receipt = await api('/warehouse/receipts', { purchaseOrderId: po._id, expectedVersion: 2, vendorId: vendor._id, lineIndex: 0, quantity: '10', uom: 'KG', idempotencyKey: randomUUID() }, 201);
  await api(`/warehouse/receipts/${receipt._id}/release`, { expectedVersion: 1, reason: 'Synthetic QC release', idempotencyKey: randomUUID() });
  await api(`/warehouse/receipts/${receipt._id}/putaway`, { expectedVersion: 2, location: 'Synthetic store', idempotencyKey: randomUUID() });
  const plan = await api('/manufacturing/work-orders', { salesOrderId: orderId, expectedVersion: 1, lineIndex: 0, uom: 'UN', quantities: ['6', '4'], idempotencyKey: randomUUID() }, 201);
  const wo = plan.workOrders[0], wp = `/manufacturing/work-orders/${wo._id}`;
  await api(`${wp}/release`, { expectedVersion: 1, operations: [{ code: 'MAKE', instruction: 'Synthetic manufacture' }], materials: [{ receiptId: receipt._id, quantityPerUnit: '1', uom: 'KG' }], idempotencyKey: randomUUID() });
  await api(`${wp}/record`, { expectedVersion: 2, operationIndex: 0, inputQuantity: '6', goodQuantity: '6', scrapQuantity: '0', uom: 'UN', evidence: 'Synthetic output', idempotencyKey: randomUUID() });
  await api(`${wp}/qc`, { expectedVersion: 3, acceptedQuantity: '6', rejectedQuantity: '0', uom: 'UN', evidence: 'Synthetic QC', idempotencyKey: randomUUID() });
  await navigate(`fulfillment/orders/${orderId}`); await wait(`document.querySelector('[name=sourceId] option[value="${wo._id}"]')`);
  await fill('sourceId', wo._id); await fill('quantity', '6'); await fill('reference', 'Synthetic Wave4i partial six'); await click('Record shipment');
  await wait('document.querySelector("tbody tr td:nth-child(3)")?.textContent==="6 UN"');
  const shipment = await db.collection('fulfillmentShipments').findOne({ salesOrderId: orderId }); assert.ok(shipment); provenance(shipment, 0);
  await wait(`document.querySelector('[name=shipmentId] option[value="${shipment._id}"]')`); await fill('shipmentId', shipment._id); await fill('invoiceQuantity', '6'); await click('Issue invoice');
  await wait('document.querySelector("tbody tr td:last-child")?.textContent==="6 UN"');
  let invoice = await db.collection('fulfillmentInvoices').findOne({ salesOrderId: orderId }); assert.ok(invoice); invoice.lines.forEach(l => provenance(l, 0));
  assert.deepEqual([invoice.netAmount, invoice.taxAmount, invoice.grossAmount], ['72000.00', '7920.00', '79920.00']);
  await navigate(`fulfillment/invoices/${invoice._id}`); await wait('document.querySelector("[name=amount]")');
  await fill('amount', invoice.grossAmount); await fill('reference', 'Synthetic Wave4i gross settlement'); await click('Allocate payment');
  await wait('document.querySelector(".pf-dl dd:last-child")?.textContent==="USD 0.00"');
  invoice = await db.collection('fulfillmentInvoices').findOne({ _id: invoice._id }); assert.equal(invoice.status, 'PAID'); invoice.lines.forEach(l => provenance(l, 0));
  await reload('document.body.innerText.includes("PAID")&&document.body.innerText.includes("SYNTH-DWG-A")');
  await call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadPath.replaceAll('/', '\\') });
  await click('Issue immutable PDF'); await wait('document.body.innerText.includes("Issued artifact loaded")');
  const intent = await db.collection('documentIntents').findOne({ kind: 'invoice', sourceId: invoice._id, sourceVersion: 1 });
  assert.equal(intent.state, 'READY');
  const metadata = await api(`/documents/issues/${intent._id}`);
  await click('Download verified PDF');
  const filename = `invoice-${metadata._id}.pdf`;
  for (let n = 0; n < 100 && !(await readdir(downloadPath)).includes(filename); n++) await new Promise(r => setTimeout(r, 100));
  const bytes = await readFile(`${downloadPath}/${filename}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.pdfHash);
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let text = ''; for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map(i => i.str).join(' ');
  await pdf.destroy();
  for (const expected of [invoice._id, '72000.00', '7920.00', '79920.00']) assert.ok(text.includes(expected), `PDF missing ${expected}`);
  await writeFile(`${downloadPath}/wave4i-sourced-vat-invoice.json`, JSON.stringify({ invoiceId: invoice._id, inquiryId: id, pdfHash: metadata.pdfHash, contentHash: metadata.contentHash, text }, null, 2));
  const original = JSON.stringify(metadata);
  await click('Issue immutable PDF'); await wait('document.body.innerText.includes("Issued artifact loaded")');
  assert.equal(JSON.stringify(await api(`/documents/issues/${intent._id}`)), original);
  assert.equal(await db.collection('documentIntents').countDocuments({ kind: 'invoice', sourceId: invoice._id }), 1);
  check('wave4i sourced VAT invoice real Chrome issue/download, parsed exact net/tax/gross, SHA256 and immutable issuance replay');
  for (const width of [375, 768, 1280]) { await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 }); await wait(`innerWidth===${width}`); assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'), false); await screenshot(`wave4i-invoice-${width}`); }
  await click('Open source inquiry'); await wait('document.body.innerText.includes("Stage: Quoted")');
  check('wave4i genuine upstream manufacture, native partial shipment/invoice/payment, independent exact VAT totals, persisted lineage, reload/source navigation and responsive widths');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
}
