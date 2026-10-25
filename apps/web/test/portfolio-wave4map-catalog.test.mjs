import test from 'node:test';
import assert from 'node:assert/strict';
import { itemCommand } from '../src/features/portfolio/internal-planning.mjs';
import { catalogCapability,catalogItems,catalogReceiptCommand,catalogRequestCommand,catalogTransitionCommand,legacyReceiptEligible,receiptDetailPath,trackedItemCommand } from '../src/features/portfolio/catalog-procurement.mjs';

const item = () => ({ _id:'item',version:4,currentRevision:2,status:'APPROVED',content:{ schema:'INVENTORY_ITEM_V2',trackingPolicy:'LOT',kind:'PURCHASED',description:'Actual supplier item',uom:'SET' },contentHash:'approved-hash',approval:{ revision:2,contentHash:'approved-hash' },blockers:[] });
const order = policy => ({ _id:'po',version:2,content:{ vendorId:'vendor',lines:[{ lineId:'line-uuid',trackingPolicy:policy,uom:'SET' }] } });

test('typed eligibility requires current approved PURCHASED V2 with explicit actual tracking policy', () => {
  const valid=item();
  assert.deepEqual(catalogItems([valid,{ ...valid,status:'DRAFT' },{ ...valid,content:{ ...valid.content,kind:'MANUFACTURED' } },{ ...valid,content:{ ...valid.content,schema:undefined,trackingPolicy:undefined } },{ ...valid,content:{ ...valid.content,trackingPolicy:'INFERRED' } }]),[valid]);
});
test('old approvals, changed content and incomplete blocker reads never authorize typed selection', () => {
  const valid=item();
  assert.deepEqual(catalogItems([{ ...valid,currentRevision:3 },{ ...valid,contentHash:'changed' },{ ...valid,blockers:['OWNER_MISMATCH'] },{ ...valid,blockers:undefined },{ ...valid,approval:null }]),[]);
});
test('explicit V2 creation sends paired schema/policy without inferred ownership or supplied source approval', () => {
  const values={ code:'SUPPLIER_PART',description:'Actual supplied item',uom:'SET',kind:'PURCHASED',trackingPolicy:'LOT',reason:'Explicit tracked item definition',ownerLegalEntityId:'forged' };
  assert.deepEqual(trackedItemCommand(null,values,'create-key'),{ expectedVersion:1,reason:values.reason,idempotencyKey:'create-key',code:'SUPPLIER_PART',description:values.description,uom:'SET',kind:'PURCHASED',schema:'INVENTORY_ITEM_V2',trackingPolicy:'LOT' });
  assert.equal(Object.hasOwn(itemCommand(null,values,'legacy-key'),'trackingPolicy'),false);
  assert.equal(Object.hasOwn(itemCommand(null,values,'legacy-key'),'schema'),false);
});
test('tracking revision does not rewrite immutable code or invent a policy for a missing choice', () => {
  const command=trackedItemCommand(item(),{ code:'FORGED',description:'New definition',uom:'SET',kind:'PURCHASED',reason:'Record explicit policy' },'revision-key');
  assert.equal(Object.hasOwn(command,'code'),false);assert.equal(command.expectedVersion,4);assert.equal(command.trackingPolicy,undefined);assert.equal(command.schema,'INVENTORY_ITEM_V2');
});
test('catalog request captures real item version/revision, exact strings and fixed document policies', () => {
  const source=item(),values={ vendorId:'vendor',itemId0:'item',quantity0:'2.500000',unitPrice0:'10.00',currency0:'IDR',reason:'Actual purchasing demand',itemVersion:999,trackingPolicy:'SERIAL',lineId:'forged',uom:'FORGED',ownerLegalEntityId:'forged' };
  const command=catalogRequestCommand(null,[source],values,1,'request-key');source.version=10;source.currentRevision=8;
  assert.deepEqual(command,{ expectedVersion:1,reason:values.reason,idempotencyKey:'request-key',vendorId:'vendor',taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{ itemId:'item',itemVersion:4,itemRevision:2,quantity:'2.500000',unitPrice:'10.00',currency:'IDR' }] });
});
test('request revision captures current head and lets server preserve per-item line identity', () => {
  const values={ vendorId:'vendor',itemId0:'item',quantity0:'4',unitPrice0:'1.00',currency0:'USD',reason:'Revised actual demand' };
  const command=catalogRequestCommand({ version:7 },[item()],values,1,'revise-key');assert.equal(command.expectedVersion,7);assert.equal(Object.hasOwn(command.lines[0],'lineId'),false);
});
test('missing source never falls back to caller-provided item versions or policy', () => {
  const body=catalogRequestCommand(null,[],{ itemId0:'missing',itemVersion:99,itemRevision:99,quantity0:'1',unitPrice0:'1.00',currency0:'IDR',reason:'Missing approval evidence' },1,'missing-key');
  assert.equal(body.lines[0].itemVersion,undefined);assert.equal(body.lines[0].itemRevision,undefined);
});
test('approval binds current content revision; conversion and issue send no invented stock or customer fields', () => {
  const head={ version:5,currentRevision:3 },values={ reason:'Approve exact request revision',revision:99,salesOrderId:'forged',stockAvailable:true };
  assert.deepEqual(catalogTransitionCommand(head,values,'approve-key',true),{ expectedVersion:5,reason:values.reason,idempotencyKey:'approve-key',revision:3 });
  assert.deepEqual(catalogTransitionCommand(head,values,'convert-key'),{ expectedVersion:5,reason:values.reason,idempotencyKey:'convert-key' });
});
test('LOT receipt captures exact PO lineage, supplied trace and partial quantity without caller UOM or stock authority', () => {
  const state=order('LOT'),values={ lineId:'line-uuid',quantity:'1.25',lotNumber:'SUPPLIER/LOT-1',heatNumber:'HEAT.1',reason:'Actual supplier intake',serials:'FAKE',uom:'FORGED',lineIndex:99,availableQuantity:'1.25',vendorId:'forged' };
  const body=catalogReceiptCommand(state,values,'receipt-key');state.version=8;state.content.vendorId='changed';
  assert.deepEqual(body,{ expectedVersion:2,reason:values.reason,idempotencyKey:'receipt-key',purchaseOrderId:'po',vendorId:'vendor',lineId:'line-uuid',quantity:'1.25',lotNumber:'SUPPLIER/LOT-1',heatNumber:'HEAT.1',serials:[] });
});
test('SERIAL receipt captures only actual explicitly entered identities without auto numbering or UOM conversion', () => {
  const body=catalogReceiptCommand(order('SERIAL'),{ lineId:'line-uuid',quantity:'2',serials:'PART_01\nPART-02',reason:'Actual supplied serial evidence' },'serial-key');
  assert.deepEqual(body.serials,['PART_01','PART-02']);assert.equal(Object.hasOwn(body,'lotNumber'),false);assert.equal(Object.hasOwn(body,'uom'),false);
  assert.deepEqual(catalogReceiptCommand(order('SERIAL'),{ lineId:'line-uuid',quantity:'2',reason:'No invented identities' },'empty-key').serials,[]);
});
test('partial serial trace is retained for server rejection instead of silently fabricating or dropping its pair', () => {
  const body=catalogReceiptCommand(order('SERIAL'),{ lineId:'line-uuid',quantity:'1',serials:'PART_01',lotNumber:'ACTUAL-LOT',heatNumber:'',reason:'Review supplied trace pair' },'trace-key');
  assert.equal(body.lotNumber,'ACTUAL-LOT');assert.equal(body.heatNumber,'');
});
test('catalog actions stay distinct from existing procurement, warehouse and master grants', () => {
  for(const action of ['catalog.read','catalog.write','catalog.approve','catalog.convert','catalog.issue','catalog.receive']) {
    assert.equal(catalogCapability(action,['procurement.read','procurement.write','warehouse.read','warehouse.receive','master.read']).enabled,false);
    assert.equal(catalogCapability(action,[action]).enabled,true);
  }
  assert.equal(catalogCapability('catalog.receive',undefined).enabled,false);
});
test('legacy operations require positive server lineage proof and never infer eligibility from absent marker', () => {
  assert.equal(legacyReceiptEligible({ receiptOrigin:{ cohort:'LEGACY',legacyEligible:true } }),true);
  for(const receipt of [{},{ catalogSource:null },{ receiptOrigin:{ cohort:'LEGACY',legacyEligible:false } },{ receiptOrigin:{ cohort:'INVALID',legacyEligible:true } },{ receiptOrigin:{ cohort:'CATALOG',legacyEligible:true } }])assert.equal(legacyReceiptEligible(receipt),false);
});
test('catalog receipts route to typed evidence even when client marker is absent; invalid origin remains blocked legacy review', () => {
  assert.equal(receiptDetailPath({ _id:'receipt',receiptOrigin:{ cohort:'CATALOG',legacyEligible:false } }),'/portfolio/catalog-procurement/receipts/receipt');
  assert.equal(receiptDetailPath({ _id:'invalid',receiptOrigin:{ cohort:'INVALID',legacyEligible:false } }),'/portfolio/warehouse/receipts/invalid');
});
