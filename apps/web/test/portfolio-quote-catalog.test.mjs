import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogQuoteOptions,catalogQuoteContent,catalogQuoteTransition,capturedQuoteItem,quoteItemValidity,catalogQuoteHint } from '../src/features/portfolio/quote-catalog.mjs';
import { operatorFailure } from '../src/features/portfolio/operator.mjs';
const item={_id:'actual-item',code:'ACTUAL-CODE',version:4,currentRevision:2,content:{description:'Actual item',kind:'MANUFACTURED',uom:'UN',trackingPolicy:'SERIAL'},eligible:true};
const values={accountId:'actual-account',expiresAt:'2027-01-01T00:00:00.000Z',description0:' Exact commercial prose ',quantity0:'2.000',uom0:'FORGED',unitPrice0:'123456789.99',currency0:'USD',itemVersion0:99,catalogBinding:{forged:true}};
test('typed quote captures explicit approved item authority and exact commercial strings, never caller snapshot or UOM',()=>{
  const body=catalogQuoteContent(values,[item],'retained-key');
  assert.deepEqual(body,{schema:'CATALOG_QUOTE_V1',accountId:'actual-account',expiresAt:values.expiresAt,taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:' Exact commercial prose ',quantity:'2.000',uom:'UN',unitPrice:'123456789.99',currency:'USD',catalogItem:{itemId:'actual-item',itemVersion:4,itemRevision:2}}],idempotencyKey:'retained-key'});
});
test('typed revision captures its actual head and rejects legacy retrofit or incomplete authority',()=>{
  const quote={schema:'CATALOG_QUOTE_V1',version:7,revisions:[{number:3}]},body=catalogQuoteContent(values,[item],'revision-key',quote);
  assert.equal(body.expectedVersion,7);assert.equal(Object.hasOwn(body,'accountId'),false);
  assert.throws(()=>catalogQuoteContent(values,[item],'key',{version:7}),/cannot be upgraded/);
  for(const invalid of [[],[null],[{...item,version:undefined}],[{...item,currentRevision:0}],[{...item,content:{}}]])assert.throws(()=>catalogQuoteContent(values,invalid,'key'),/approved item/);
});
test('catalog selections distinguish captured revision from fresh eligibility without rebinding',()=>{
  const captured=structuredClone(item),newer={...item,version:6,currentRevision:3};
  assert.equal(quoteItemValidity(captured,item,'MANUFACTURED').valid,true);
  for(const current of [null,{...item,_id:'another'}, {...item,eligible:false},newer])assert.equal(quoteItemValidity(captured,current,'MANUFACTURED').valid,false);
  assert.equal(quoteItemValidity(captured,item,'PURCHASED').valid,false);assert.equal(quoteItemValidity(captured,item,'').valid,false);
  assert.match(quoteItemValidity(captured,newer,'MANUFACTURED').reason,/explicitly/);assert.equal(captured.version,4);
});
test('typed transition command preserves exact quote revision and stable retry key independently of later current metadata',()=>{
  const quote={schema:'CATALOG_QUOTE_V1',version:8,revisions:[{number:1},{number:3}],catalogEntitlement:{currentEligible:false}};
  const body=catalogQuoteTransition(quote,'same-key');assert.deepEqual(body,{expectedVersion:8,revision:3,idempotencyKey:'same-key'});
  quote.version=9;assert.equal(body.expectedVersion,8);
});
test('catalog option prefix and cursor are encoded and hydration preserves immutable binding snapshot',()=>{
  assert.equal(catalogQuoteOptions({q:' A/B + ',cursor:'id/+'}),'/api/commercial/catalog-items?q=A%2FB%20%2B&limit=25&cursor=id%2F%2B');
  assert.equal(capturedQuoteItem({catalogBinding:{itemSnapshot:item}}),item);assert.equal(capturedQuoteItem({description:'Same description'}),null);
});
test('catalog recovery copy separates fresh revision drift, proof corruption and serial quantity limits',()=>{
  assert.match(catalogQuoteHint({code:'QUOTE_ITEM_CHANGED'}),/explicitly/);assert.match(catalogQuoteHint({code:'QUOTE_SOURCE_INVALID'}),/inconsistent/);assert.match(catalogQuoteHint({code:'SERIAL_QUANTITY_REQUIRED'}),/whole/);assert.equal(catalogQuoteHint({code:'UNKNOWN'}),'');
});
test('unsupported catalog fulfillment explains a future workflow instead of suggesting an ineffective refresh',()=>{
  const message=operatorFailure({status:409,code:'CATALOG_ORDER_UNSUPPORTED'},true);assert.match(message,/awaiting item-aware fulfillment/);assert.equal(message.includes('Refresh'),false);
  assert.match(operatorFailure({status:403,code:'CATALOG_ORDER_UNSUPPORTED'},true),/Access denied/);
});
