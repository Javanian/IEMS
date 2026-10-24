import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, renderPdf, contentHash } from '../src/index.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs/promises';
const scope = { tenantId: 'tenant', legalEntityId: 'legal', plantId: 'plant' };
const triple = (netAmount,taxAmount,grossAmount) => ({ netAmount,taxAmount,grossAmount });
const policy = { taxPolicy:'FIXTURE_VAT_11_V1', taxPolicyVersion:1, taxRate:'0.11' };
export const quote = () => ({ _id:'quote', ...scope, version:2, snapshot:{ ...policy, roundingPolicy:'LINE_HALF_UP', currency:'USD', total:'135975.00', ...triple('122500.00','13475.00','135975.00'), lines:[{ description:'Fixture ten units', quantity:'10', uom:'UN', unitPrice:'12250.00', currency:'USD', amount:'122500.00', ...triple('122500.00','13475.00','135975.00') }] } });
test('VAT quote uses additive schema2 template3 immutable explicit totals and deterministic PDF', async () => {
 const s = createSnapshot('quote',scope,quote());
 assert.equal(s.schemaVersion,2); assert.equal(s.template.version,3); assert.equal(s.netAmount,'122500.00'); assert.equal(s.total,'135975.00');
 assert.ok(Object.isFrozen(s.lines[0]));
 const bytes=await renderPdf(s); const doc=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
 await fs.mkdir('evidence/wave4h',{recursive:true}); await fs.writeFile('evidence/wave4h/quote.pdf',bytes);
 for(let i=1;i<=doc.numPages;i++) {
  const page=await doc.getPage(i), items=(await page.getTextContent()).items.filter(x=>x.str), text=items.map(x=>x.str).join(' ');
  assert.match(text,/Subtotal: 122500.00/); assert.match(text,/Tax: 13475.00/); assert.match(text,/Total: 135975.00/); assert.match(text,/Fixture policy only/);
  for(const item of items) assert.ok(item.transform[4]>=47 && item.transform[4]+item.width<=550 && item.transform[5]>40 && item.transform[5]<802,item.str);
  const viewport=page.getViewport({scale:1}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
  await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise; await fs.writeFile(`evidence/wave4h/quote-${i}.png`,canvas.toBuffer('image/png'));
 }
 await doc.destroy();
 assert.deepEqual(await renderPdf(s),await renderPdf(s));
 const altered=structuredClone(s); altered.schemaVersion=1; const {contentHash:_,...body}=altered; altered.contentHash=contentHash(body);
 await assert.rejects(renderPdf(altered),/INTEGRITY|SCHEMA/);
});
export const invoice = () => ({ _id:'invoice', ...scope, version:1, ...policy, roundingPolicy:'CUMULATIVE_HALF_UP', salesOrderId:'order', salesOrderVersion:1, quoteRevision:2, currency:'USD', total:'0.01', ...triple('0.00','0.01','0.01'), lines:[{ description:'Rounding residue', quantity:'0.01', uom:'UN', unitPrice:'0.05', currency:'USD', amount:'0.00', ...triple('0.00','0.01','0.01'), shipmentId:'shipment', lineIndex:0, rounding:{ sourceId:'order', sourceVersion:1, quoteRevision:2, taxPolicyVersion:1, lineIndex:0, beforeQuantity:'0.89', afterQuantity:'0.9', beforeAmount:'0.04', afterAmount:'0.05', beforeTaxAmount:'0.00', afterTaxAmount:'0.01', beforeGrossAmount:'0.04', afterGrossAmount:'0.06' } }] });
test('unsupported policy on shipment fails closed instead of producing a false NO_TAX artifact', () => {
 assert.throws(()=>createSnapshot('shipment',scope,{ _id:'ship',...scope,version:1,salesOrderId:'order',lineIndex:0,quantity:'1',uom:'UN',reference:'ref',taxPolicy:'UNKNOWN' }),/POLICY/);
});
test('VAT quote rejects monetary and policy tampering before render', () => {
 for(const change of [x=>x.schemaVersion=99,x=>x.taxRate='0.12',x=>x.taxPolicy='UNKNOWN',x=>x.lines[0].grossAmount='1.00',x=>x.lines[0].amount='1.00',x=>x.taxAmount='1.00',x=>x.netAmount='1.00']) {
  const q=quote(); change(q.snapshot); assert.throws(()=>createSnapshot('quote',scope,q),/POLICY|MISMATCH/);
 }
});
test('VAT invoice validates cumulative entitlement differences not naive tax rerounding', async () => {
 const input=invoice(); input.lines[0].netAmount='0.01'; input.lines[0].amount='0.01'; input.netAmount='0.01'; input.grossAmount='0.02'; input.total='0.02'; input.lines[0].grossAmount='0.02';
 const s=createSnapshot('invoice',scope,input);
 assert.equal(s.taxAmount,'0.01'); assert.equal(s.salesOrderId,'order'); assert.equal(s.quoteRevision,2); assert.equal(s.lines[0].shipmentId,'shipment');
 assert.deepEqual(s.lines[0].rounding,input.lines[0].rounding);
 await renderPdf(s);
 for(const mutate of [x=>x.lines[0].rounding.afterTaxAmount='0.02', x=>x.lines[0].rounding.sourceVersion=2, x=>x.lines[0].rounding.sourceId='other', x=>x.lines[0].taxAmount='0.00', x=>x.taxPolicyVersion=2, x=>x.total='0.03']) {
  const bad=structuredClone(input); mutate(bad); assert.throws(()=>createSnapshot('invoice',scope,bad),/MISMATCH|PROVENANCE|POLICY/);
 }
});
