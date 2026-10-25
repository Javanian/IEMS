import test from 'node:test';
import assert from 'node:assert/strict';
import { approveInspectionCommand,dispositionHint,dispositionPath,inspectionCommand,putawayCatalogCommand } from '../src/features/portfolio/catalog-disposition.mjs';
import { catalogCapability,legacyReceiptEligible,receiptDetailPath } from '../src/features/portfolio/catalog-procurement.mjs';

const view = policy => ({ receiptId:'receipt',receiptVersion:9,version:1,currentRevision:0,trackingPolicy:policy });
test('LOT draft captures virtual head version1 and actual receipt fence without serial-array fields', () => {
  const state=view('LOT'),values={ acceptedQuantity:'1.25',rejectedQuantity:'0.25',evidence:'Actual inspection evidence',reason:'Record measured partition',acceptedSerials:['forged'],rejectedSerials:[],expectedVersion:99,expectedReceiptVersion:99,stockAvailable:'1.25' };
  const body=inspectionCommand(state,values,'inspection-key');state.version=7;state.receiptVersion=20;
  assert.deepEqual(body,{ expectedVersion:1,expectedReceiptVersion:9,reason:values.reason,idempotencyKey:'inspection-key',acceptedQuantity:'1.25',rejectedQuantity:'0.25',evidence:values.evidence });
});
test('SERIAL draft copies explicit real serial sets while retaining independently entered quantity strings', () => {
  const values={ acceptedQuantity:'2',rejectedQuantity:'1',acceptedSerials:['ACTUAL_01','ACTUAL_03'],rejectedSerials:['ACTUAL_02'],evidence:'Actual serial inspection',reason:'Record observed serial partition' };
  const body=inspectionCommand(view('SERIAL'),values,'serial-key');values.acceptedSerials.pop();values.rejectedSerials.push('later-change');
  assert.deepEqual(body.acceptedSerials,['ACTUAL_01','ACTUAL_03']);assert.deepEqual(body.rejectedSerials,['ACTUAL_02']);assert.equal(body.acceptedQuantity,'2');assert.equal(body.rejectedQuantity,'1');
});
test('SERIAL never infers a complement, quantities or serials from missing input', () => {
  const body=inspectionCommand(view('SERIAL'),{ acceptedQuantity:'0',rejectedQuantity:'3',evidence:'No inferred source identity',reason:'Review explicit required sets' },'empty-key');
  assert.deepEqual(body.acceptedSerials,[]);assert.deepEqual(body.rejectedSerials,[]);assert.equal(body.rejectedQuantity,'3');
});
test('SERIAL mismatch and overlap remain operator input for authoritative rejection, without silent correction', () => {
  const body=inspectionCommand(view('SERIAL'),{ acceptedQuantity:'99',rejectedQuantity:'0',acceptedSerials:['ACTUAL_01'],rejectedSerials:['ACTUAL_01'],evidence:'Input requires review',reason:'No automatic partition fix' },'review-key');
  assert.equal(body.acceptedQuantity,'99');assert.deepEqual(body.acceptedSerials,['ACTUAL_01']);assert.deepEqual(body.rejectedSerials,['ACTUAL_01']);
});
test('approval captures current draft revision and both fences, without caller partition or stock authority', () => {
  const state={ ...view('LOT'),version:3,currentRevision:2 },values={ reason:'Approve exact recorded inspection',revision:99,acceptedQuantity:'99',quantity:'99',status:'STORED',canAllocate:true };
  const body=approveInspectionCommand(state,values,'approve-key');state.currentRevision=8;state.version=10;
  assert.deepEqual(body,{ expectedVersion:3,expectedReceiptVersion:9,reason:values.reason,idempotencyKey:'approve-key',revision:2 });
});
test('putaway captures exact qualified location version and omits caller quantity, bin, serial and owner overrides', () => {
  const location={ _id:'location',version:5,binSnapshot:{ _id:'bin',version:4 } },values={ locationId:'location',reason:'Store whole approved accepted stock',expectedLocationVersion:99,quantity:'99',serials:['forged'],ownerLegalEntityId:'forged',binId:'forged' };
  const body=putawayCatalogCommand({ ...view('SERIAL'),version:4 },[location],values,'putaway-key');location.version=9;
  assert.deepEqual(body,{ expectedVersion:4,expectedReceiptVersion:9,reason:values.reason,idempotencyKey:'putaway-key',locationId:'location',expectedLocationVersion:5 });
});
test('missing location authority never falls back to caller-supplied location version', () => {
  const body=putawayCatalogCommand(view('LOT'),[],{ locationId:'missing',expectedLocationVersion:1,reason:'No invented qualification' },'missing-key');
  assert.equal(body.expectedLocationVersion,undefined);
});
test('new QC actions are independent of catalog receiving, warehouse quality and master grants', () => {
  const prior=['catalog.read','catalog.receive','warehouse.read','warehouse.release','warehouse.hold.apply','master.read'];
  for(const action of ['catalog.qc.read','catalog.qc.record','catalog.qc.approve','catalog.putaway']) {
    assert.equal(catalogCapability(action,prior).enabled,false);assert.equal(catalogCapability(action,[action]).enabled,true);
  }
});
test('QC-only catalog receipt navigation uses standalone detail and keeps invalid origins fail closed', () => {
  const receipt={ _id:'actual-receipt',receiptOrigin:{ cohort:'CATALOG',legacyEligible:false } };
  assert.equal(receiptDetailPath(receipt,['catalog.qc.read','warehouse.read']),'/portfolio/catalog-disposition/receipts/actual-receipt');
  assert.equal(receiptDetailPath(receipt,['catalog.qc.read','catalog.read']),'/portfolio/catalog-procurement/receipts/actual-receipt');
  assert.equal(receiptDetailPath({ ...receipt,receiptOrigin:{ cohort:'INVALID',legacyEligible:false } },['catalog.qc.read']),'/portfolio/warehouse/receipts/actual-receipt');
  assert.equal(legacyReceiptEligible({ ...receipt,status:'CATALOG_STORED' }),false);
});
test('disposition route and recovery distinguish historical inspection, terminal rejection and live eligibility', () => {
  assert.equal(dispositionPath('actual-receipt'),'/api/catalog-disposition/receipts/actual-receipt');
  assert.match(dispositionHint({ code:'STOCK_ENCUMBERED' }),/Historical inspection may still be recorded/);
  assert.match(dispositionHint({ code:'CATALOG_DISPOSITION_STATE_CONFLICT' }),/Rejected stock cannot be put away or reused/);
  assert.match(dispositionHint({ code:'CATALOG_DEPENDENCY_CHANGED' }),/Stored quantities remain separate from current eligibility/);
  assert.equal(dispositionHint({ code:'UNKNOWN' }),null);
});
