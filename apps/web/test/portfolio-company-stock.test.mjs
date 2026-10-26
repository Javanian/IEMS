import test from 'node:test';
import assert from 'node:assert/strict';
import { companyReservationFields, companyStockActionBlockedReason, companyStockCommand, companyStockHint, companyStockOptionsPath, companyStockVersionMatches, consumedCompanyUnits, currentCompanyStock, mixedAttributionSources, reservationFields } from '../src/features/portfolio/company-stock.mjs';
import { internalPlanCommand } from '../src/features/portfolio/internal-planning.mjs';

const source = () => ({ _id:'company-receipt', version:3, uom:'UN', sourcePolicy:'ONE_HOP_SOURCE', canReserve:true, units:[{ _id:'u1',version:2,status:'AVAILABLE',eligible:true,serial:'COMP-1' },{ _id:'u2',version:1,status:'AVAILABLE',eligible:true,serial:'COMP-2' }] });
test('planning leaves legacy schema absent and only explicit opt-in creates V2', () => {
  const item={ _id:'item',currentRevision:2,version:5 },location={ _id:'loc',version:4 },values={ itemId:'item',locationId:'loc',quantity:'2',reason:'Approved plan' };
  const legacy=internalPlanCommand([item],[location],values,'key');assert.equal(Object.hasOwn(legacy,'schema'),false);
  assert.deepEqual(internalPlanCommand([item],[location],{...values,schema:'INTERNAL_PLAN_V2'},'key'),{...legacy,schema:'INTERNAL_PLAN_V2'});
});
test('company options bind exact material revision and a bounded cursor without changing its identity', () => {
  const url=new URL(companyStockOptionsPath({itemId:'a/b',itemRevision:4},'next/id'),'http://localhost');
  assert.equal(url.pathname,'/api/company-stock/receipts');assert.deepEqual(Object.fromEntries(url.searchParams),{itemId:'a/b',itemRevision:'4',limit:'25',cursor:'next/id'});
});
test('current detail never accepts retained list data, wrong source, loading or failed read', () => {
  const row=source();assert.equal(currentCompanyStock(row,{data:row}),row);
  for(const resource of [{data:[row]},{data:{...row,_id:'other'}},{data:row,loading:true},{data:row,error:Error('offline')},{data:{...row,units:null}}])assert.equal(currentCompanyStock(row,resource),null);
});
test('selection requires current positive stock and unit fences plus live source eligibility', () => {
  const captured=source();assert.equal(companyStockVersionMatches(captured,source()),true);
  for(const current of [{...source(),version:4},{...source(),version:0},{...source(),canReserve:false},{...source(),sourcePolicy:'LEAF_ONLY'},{...source(),units:[{...source().units[0],version:8},source().units[1]]}])assert.equal(companyStockVersionMatches(captured,current),false);
  assert.equal(companyStockVersionMatches({ _id:'company-receipt',version:3 },source()),false);
});
test('company reservation sends explicit selected unit versions and no received-material fields', () => {
  const fields=companyReservationFields(source(),{quantity:'2',companyUnitIds:['u2','u1']});
  assert.deepEqual(fields,{sourceKind:'COMPANY_OUTPUT',companyReceiptId:'company-receipt',expectedStockVersion:3,quantity:'2',units:[{companyUnitId:'u2',expectedUnitVersion:1},{companyUnitId:'u1',expectedUnitVersion:2}]});
  for(const name of ['receiptId','serials','expectedReceiptVersion'])assert.equal(Object.hasOwn(fields,name),false);
});
test('company reservation refuses registry-only, foreign, duplicated, blocked and quantity-mismatched choices', () => {
  for(const values of [{quantity:'1',companyUnitIds:[]},{quantity:'2',companyUnitIds:['u1','u1']},{quantity:'1',companyUnitIds:['foreign']},{quantity:'2',companyUnitIds:['u1']},{quantity:'1.5',companyUnitIds:['u1']},{quantity:'1',companyUnitIds:'u1'}])assert.throws(()=>companyReservationFields(source(),values));
  for(const row of [{...source(),sourcePolicy:'LEAF_ONLY'},{...source(),canReserve:false},{...source(),units:[{...source().units[0],eligible:false}]}])assert.throws(()=>companyReservationFields(row,{quantity:'1',companyUnitIds:['u1']}));
});
test('catalog V1 command stays exact while V2 includes only its catalog discriminator', () => {
  const material={lineId:'line',itemSnapshot:{content:{trackingPolicy:'LOT'}}},stock={receiptId:'received',receiptVersion:7,version:4},values={quantity:'2.5'};
  const old={materialLineId:'line',receiptId:'received',expectedReceiptVersion:7,expectedStockVersion:4,quantity:'2.5'};
  assert.deepEqual(reservationFields({schema:'INTERNAL_EXECUTION_V1'},material,stock,values),old);
  assert.deepEqual(reservationFields({schema:'INTERNAL_EXECUTION_V2'},material,stock,values),{...old,sourceKind:'CATALOG_RECEIPT'});
});
test('typed attribution retains separate namespaces, exact selected identities and explicit losses', () => {
  const stocks=[{receiptId:'same-id',source:{trackingPolicy:'SERIAL'}},{...source(),_id:'same-id',sourceKind:'COMPANY_OUTPUT'}];
  assert.deepEqual(mixedAttributionSources(stocks,{quantity0:'2',serials0:['RAW-1','RAW-2'],quantity1:'1',companyUnitIds1:['u2']}),[{sourceKind:'CATALOG_RECEIPT',receiptId:'same-id',quantity:'2',serials:['RAW-1','RAW-2']},{sourceKind:'COMPANY_OUTPUT',companyReceiptId:'same-id',quantity:'1',companyUnitIds:['u2']}]);
  assert.deepEqual(mixedAttributionSources(stocks,{quantity0:'0.000',quantity1:''}),[]);
});
test('attribution offers only actual consumed company identities belonging to this job receipt', () => {
  const current=source(),view={reservations:[{sourceKind:'COMPANY_OUTPUT',companyReceiptId:current._id,status:'CONSUMED',companyUnitIds:['u2']},{sourceKind:'COMPANY_OUTPUT',companyReceiptId:'other',status:'CONSUMED',companyUnitIds:['u1']},{sourceKind:'COMPANY_OUTPUT',companyReceiptId:current._id,status:'RELEASED',companyUnitIds:['u1']}]};
  assert.deepEqual(consumedCompanyUnits(current,view).map(row=>row._id),['u2']);
});
test('hold release binds actual current hold ID and stock version without fabricating stock recovery', () => {
  const row={...source(),hold:{_id:'hold-1',active:true}};
  assert.deepEqual(companyStockCommand(row,{reason:'Reviewed',reasonCode:'QUALITY_SUSPECT'},'key',true),{expectedVersion:3,reason:'Reviewed',idempotencyKey:'key',expectedHoldId:'hold-1'});
});
test('reservation history exhaustion keeps positive stock and independently permitted hold actions', () => {
  const row={...source(),availableQuantity:'2',eligibleQuantity:'2',canReserve:false,canHold:true,canReleaseHold:true,reserveBlockers:['RESERVATION_HISTORY_LIMIT'],capacity:{reservationLimitReached:true,eventLimitReached:false}};
  const before=structuredClone(row);
  assert.match(companyStockActionBlockedReason(row,'reserve'),/reservation history limit.*physical stock remains available/);
  assert.equal(companyStockActionBlockedReason(row,'hold'),null);
  assert.equal(companyStockActionBlockedReason(row,'releaseHold'),null);
  assert.equal(companyStockVersionMatches(row,row),false);
  assert.throws(()=>companyReservationFields(row,{quantity:'1',companyUnitIds:['u1']}));
  assert.deepEqual(row,before);
});
test('hard event exhaustion explains disabled recovery without claiming stock has disappeared', () => {
  const row={...source(),canReserve:false,canHold:false,canReleaseHold:false,reserveBlockers:['STOCK_EVENT_HISTORY_LIMIT'],capacity:{eventLimitReached:true}};
  for(const action of ['reserve','hold','releaseHold'])assert.match(companyStockActionBlockedReason(row,action),/stock event history limit.*No further stock-changing command/);
  assert.match(companyStockHint({code:'STOCK_HISTORY_LIMIT'}),/Refresh.*reservation and stock event limits/);
});
test('authoritative action flags govern the last legal event and missing readiness fails closed', () => {
  const row={...source(),canHold:true,canReleaseHold:false,capacity:{remainingEvents:1,eventLimitReached:false}};
  assert.equal(companyStockActionBlockedReason(row,'reserve'),null);
  assert.equal(companyStockActionBlockedReason(row,'hold'),null);
  assert.match(companyStockActionBlockedReason(row,'releaseHold'),/Refresh/);
  assert.match(companyStockActionBlockedReason({},'hold'),/Refresh/);
  assert.throws(()=>companyStockActionBlockedReason(row,'invalid'));
});
