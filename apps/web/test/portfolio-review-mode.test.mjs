import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewRunPlan } from './portfolio-review-mode.mjs';

test('isolated review debug forces all three actual journeys and fixture actors without claiming prior coverage',()=>{
  assert.deepEqual(reviewRunPlan({PORTFOLIO_REVIEW_DEBUG_ONLY:'1'}),{
    diagnosticOnly:true,textProbeOnly:false,companyOnly:false,e01:true,internalExecution:true,companyStock:false,operator:true,seedOperators:true,
    resultsFile:'review-debug-results.json',priorJourneyCoverage:false,
  });
});
test('explicit full mode preserves selected review flags and the acceptance result filename',()=>{
  const plan=reviewRunPlan({PORTFOLIO_REVIEW_DEBUG_ONLY:'0',PORTFOLIO_REVIEW_E01:'1',PORTFOLIO_INTERNAL_EXECUTION:'1',PORTFOLIO_REVIEW_OPERATOR:'1'});
  assert.equal(plan.diagnosticOnly,false);assert.equal(plan.priorJourneyCoverage,true);
  assert.equal(plan.resultsFile,'browser-results.json');
  assert.ok(plan.e01 && plan.internalExecution && plan.operator && plan.seedOperators);
});
test('the normal default keeps original five-user seeding and does not enable review journeys',()=>{
  const plan=reviewRunPlan();
  assert.equal(plan.diagnosticOnly,false);assert.equal(plan.seedOperators,false);
  assert.equal(plan.e01 || plan.internalExecution || plan.operator,false);
  assert.equal(reviewRunPlan({PORTFOLIO_INTERNAL_EXECUTION:'1'}).internalExecution,true);
  assert.equal(reviewRunPlan({PORTFOLIO_INTERNAL_EXECUTION:'1'}).seedOperators,false);
  const company=reviewRunPlan({PORTFOLIO_COMPANY_STOCK:'1'});
  assert.equal(company.companyStock,true);assert.equal(company.diagnosticOnly,false);
  assert.equal(company.priorJourneyCoverage,true);assert.equal(company.internalExecution,false);
});
test('ambiguous debug flag values fail before services start instead of silently selecting a different coverage mode',()=>{
  for(const value of ['true','false','yes','',1,null])assert.throws(()=>reviewRunPlan({PORTFOLIO_REVIEW_DEBUG_ONLY:value}),/must be 0 or 1/);
  for(const value of ['true','false','yes','',1,null])assert.throws(()=>reviewRunPlan({PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY:value}),/must be 0 or 1/);
});
test('text probe is explicitly isolated and seeds actors for actual API invoice setup without enabling native review journeys',()=>{
  const mode=reviewRunPlan({PORTFOLIO_TEXT_DIAGNOSTIC_ONLY:'1'});
  assert.ok(mode.diagnosticOnly && mode.textProbeOnly && mode.seedOperators);
  assert.equal(mode.e01 || mode.operator || mode.internalExecution,false);
  assert.equal(mode.resultsFile,'review-text-probe-results.json');assert.equal(mode.priorJourneyCoverage,false);
  assert.throws(()=>reviewRunPlan({PORTFOLIO_REVIEW_DEBUG_ONLY:'1',PORTFOLIO_TEXT_DIAGNOSTIC_ONLY:'1'}),/Choose one diagnostic entry/);
  const company=reviewRunPlan({PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY:'1',PORTFOLIO_REVIEW_E01:'1',PORTFOLIO_INTERNAL_EXECUTION:'1',PORTFOLIO_REVIEW_OPERATOR:'1'});
  assert.ok(company.diagnosticOnly&&company.companyOnly&&company.companyStock);
  assert.equal(company.e01||company.internalExecution||company.operator||company.seedOperators,false);
  assert.equal(company.priorJourneyCoverage,false);assert.equal(company.resultsFile,'company-stock-debug-results.json');
  assert.throws(()=>reviewRunPlan({PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY:'1',PORTFOLIO_REVIEW_DEBUG_ONLY:'1'}),/Choose one diagnostic entry/);
});
