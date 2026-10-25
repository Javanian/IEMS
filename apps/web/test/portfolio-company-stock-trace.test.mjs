import test from 'node:test';
import assert from 'node:assert/strict';
import { companyTraceHint, companyUnitTracePath, currentCompanyUnitTrace } from '../src/features/portfolio/company-stock-trace.mjs';

const binding = { receiptId:'receipt-a', unitId:'unit-a' };
const trace = () => ({ schema:'COMPANY_UNIT_TRACE_V1',companyReceiptId:'receipt-a',companyUnitId:'unit-a',serial:'COMP-1',sourcePolicy:'ONE_HOP_SOURCE',itemSnapshot:{code:'COMP',content:{description:'Manufactured component'}},locationSnapshot:{code:'BIN'},current:{stockVersion:2,unitVersion:1,status:'AVAILABLE',eligible:true,blockers:[]},producer:{executionId:'producer-a'},ancestry:{basis:'EXACT_OUTPUT_ATTRIBUTION',purchasedSources:[],companySources:[]},holdPolicy:{basis:'CONSERVATIVE_CONSUMED_BATCH',receiptIds:[]},uses:{reserved:[],issued:[],consumedUnattributed:[],outputs:[],losses:[],abandoned:[]},completeness:{complete:true,oneGeneration:true} });

test('unit trace binds receipt and actual unit independently, including encoded path segments', () => {
  assert.equal(companyUnitTracePath('receipt/a','unit?b'),'/api/company-stock/receipts/receipt%2Fa/units/unit%3Fb/trace');
  const data=trace();assert.equal(currentCompanyUnitTrace(binding,{data}),data);
  assert.equal(currentCompanyUnitTrace({...binding,unitId:'unit-b'},{data}),null);
  assert.equal(currentCompanyUnitTrace({...binding,receiptId:'receipt-b'},{data}),null);
});
test('a retained old read is never shown as current during loading, error or selection changes', () => {
  const data=trace();
  for(const resource of [{loading:true,data},{error:Error('offline'),data},{data:[data]},{data:null},{data:{...data,companyUnitId:'previous-unit'}}])assert.equal(currentCompanyUnitTrace(binding,resource),null);
});
test('partial or unsupported trace scope does not masquerade as complete ancestry', () => {
  const data=trace();
  for(const value of [{...data,completeness:{complete:false,oneGeneration:true}},{...data,completeness:{complete:true,oneGeneration:false}},{...data,schema:'UNKNOWN'},{...data,ancestry:{...data.ancestry,basis:'CONSERVATIVE_CONSUMED_BATCH'}},{...data,holdPolicy:{...data.holdPolicy,basis:'EXACT_OUTPUT_ATTRIBUTION'}}])assert.equal(currentCompanyUnitTrace(binding,{data:value}),null);
});
test('an absent category is rejected rather than turned into a false no-use result', () => {
  for(const category of ['reserved','issued','consumedUnattributed','outputs','losses','abandoned']) {
    const data=trace();delete data.uses[category];assert.equal(currentCompanyUnitTrace(binding,{data}),null);
  }
  const data=trace();data.ancestry.companySources=null;assert.equal(currentCompanyUnitTrace(binding,{data}),null);
});
test('exact attribution and conservative hold set stay separate even under current restriction', () => {
  const data=trace();data.ancestry.purchasedSources=[{receiptId:'exact',quantity:'1.25',uom:'KG'}];data.holdPolicy.receiptIds=['exact','other-batch-receipt'];data.current={...data.current,status:'CONSUMED',eligible:false,blockers:['ANCESTOR_HELD']};
  assert.equal(currentCompanyUnitTrace(binding,{data}),data);
  assert.deepEqual(data.ancestry.purchasedSources.map(row=>row.receiptId),['exact']);
  assert.deepEqual(data.holdPolicy.receiptIds,['exact','other-batch-receipt']);
});
test('missing render evidence fails closed instead of crashing or inventing a producer, location or unit state', () => {
  for(const key of ['current','itemSnapshot','locationSnapshot','producer']) { const data=trace();delete data[key];assert.equal(currentCompanyUnitTrace(binding,{data}),null); }
  for(const patch of [{current:{}},{current:{...trace().current,blockers:null}},{itemSnapshot:{code:'COMP'}},{uses:{...trace().uses,outputs:[{reservationId:'a'}]}},{ancestry:{...trace().ancestry,purchasedSources:[null]}}])assert.equal(currentCompanyUnitTrace(binding,{data:{...trace(),...patch}}),null);
});
test('limit and proof errors explain that no partial trace or new entitlement is supplied', () => {
  assert.match(companyTraceHint({code:'TRACE_LIMIT_EXCEEDED'}),/complete trace exceeds.*No partial trace/s);
  assert.match(companyTraceHint({code:'COMPANY_STOCK_SOURCE_INVALID'}),/could not be verified/);
  assert.match(companyTraceHint({code:'CATALOG_STOCK_SOURCE_INVALID'}),/could not be verified/);
  assert.equal(companyTraceHint({status:403}), '');
});
