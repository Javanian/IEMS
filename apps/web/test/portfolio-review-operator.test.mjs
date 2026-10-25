import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { displayReference,operatorFailure,operatorStatus,quantitySummary,workflowStage,executionQueueAction } from '../src/features/portfolio/operator.mjs';
import { capturedRequestItem,createLatestOptions,optionPath,selectionValidity } from '../src/features/portfolio/server-options.mjs';
import { attributionSources,consumedSourceIdentities,currentStockEvidence,executionCommand,sourceVersionMatches,stockOptionsPath } from '../src/features/portfolio/internal-execution.mjs';
import { laborCommand,nextLaborIndex,laborHours } from '../src/features/portfolio/labor.mjs';
import { planCommand,requiredLaborIndices } from '../src/features/portfolio/manufacturing.mjs';
const item={_id:'11111111-2222-3333-4444-555555555555',version:4,currentRevision:2,eligible:true,code:'BEARING-A',content:{uom:'UN'}};
test('operator block evidence and async source states have valid block containers',async()=>{
  const directory=new URL('../src/features/portfolio/',import.meta.url),violations=[];
  const phrasing=new Set(['p','span','strong','label','a','Link']);
  const block=new Set(['p','div','details','section','ul','ol','table','fieldset','form','AuditDetails','CustomerName','SupplierName','SourceLineage','MaterialTrace','MonetarySummary','Resource','OperatorBlockers']);
  for(const file of (await readdir(directory)).filter(name=>name.endsWith('.jsx'))){
    const ast=parse(await readFile(new URL(file,directory),'utf8'),{sourceType:'module',plugins:['jsx']});
    const walk=(node,parents=[])=>{
      if(!node || typeof node!=='object')return;
      let ancestors=parents;
      if(node.type==='JSXElement'){
        const name=node.openingElement.name.name,ancestor=parents.findLast(parent=>phrasing.has(parent));
        if(ancestor && block.has(name))violations.push(`${file}:${node.loc.start.line}: ${name} inside ${ancestor}`);
        ancestors=[...parents,name];
      }
      for(const child of Object.values(node)){
        if(Array.isArray(child))child.forEach(value=>walk(value,ancestors));
        else if(child && typeof child==='object')walk(child,ancestors);
      }
    };
    walk(ast);
  }
  assert.deepEqual(violations,[]);
});
test('operator references keep actual document numbers and distinguish document types without changing authoritative IDs',()=>{assert.equal(displayReference('orders',{_id:item._id,orderNumber:'SO-2026-031'}),'SO-2026-031');assert.equal(displayReference('workOrders',item),'WO-11111111');assert.equal(displayReference('receipts',item),'RCV-11111111');assert.equal(item._id,'11111111-2222-3333-4444-555555555555');assert.equal(displayReference('items',{}),'Reference unavailable');});
test('operator summaries preserve exact source quantities and drawing item descriptions',()=>{assert.equal(quantitySummary({lines:[{itemCode:'PLATE',quantity:'7.500001',uom:'KG'}]}),'PLATE: 7.500001 KG');assert.equal(operatorStatus('APPROVED_DEMAND'),'Planning approved');});
test('errors explain recovery and keep diagnostics out of the primary sentence',()=>{assert.match(operatorFailure({status:403,code:'SCOPE_DENIED'}),/permission/);assert.doesNotMatch(operatorFailure({status:403,code:'SCOPE_DENIED'}),/SCOPE_DENIED/);assert.match(operatorFailure({status:503},true),/uncertain.*same command/);assert.match(operatorFailure({status:409}),/Refresh/);});
test('workflow keeps repair separate and assigns quality, production and billing stages',()=>{assert.equal(workflowStage('/portfolio/repair/cases/a'),'Repair');assert.equal(workflowStage('/portfolio/catalog-disposition/receipts/a'),'Quality');assert.equal(workflowStage('/portfolio/manufacturing/internal-execution/a'),'Production');assert.equal(workflowStage('/portfolio/fulfillment/payments/a'),'Billing');});
test('production work queue distinguishes actual hold and source restrictions from reservable and fully reserved demand',()=>{assert.match(executionQueueAction({status:'PLANNED',blockers:['SOURCE_HELD'],canRelease:false}),/holds/);assert.match(executionQueueAction({status:'PLANNED',blockers:['ITEM_CHANGED'],canRelease:false}),/source restrictions/);assert.equal(executionQueueAction({status:'PLANNED',blockers:[],canRelease:false}),'Materials to reserve before release');assert.equal(executionQueueAction({status:'PLANNED',blockers:[],canRelease:true}),'Release fully reserved production');assert.equal(executionQueueAction({status:'STORED'}),null);});
test('source queries use explicit eligibility, bounded pages and encoded literal search and cursor',()=>{const path=optionPath('items',{q:'  A/B + ',cursor:item._id});assert.match(path,/eligibility=PURCHASED_V2_APPROVED/);assert.match(path,/q=A%2FB%20%2B&limit=25&cursor=/);assert.match(optionPath('vendors'),/ACTIVE_VENDOR/);assert.equal(new URL('http://local'+optionPath('items',{q:'x'.repeat(100)})).searchParams.get('q').length,80);});
test('selected item binding stays invalid after current approval moves until explicit reselection',()=>{const current={...item,version:6,currentRevision:3};assert.equal(selectionValidity('items',item,current).valid,false);assert.deepEqual(selectionValidity('items',item,current).blockers,['ITEM_CHANGED']);assert.equal(item.currentRevision,2);assert.equal(selectionValidity('items',current,current).valid,true);assert.equal(selectionValidity('items',item,{...item,eligible:false}).valid,false);assert.equal(selectionValidity('items',item,null).ready,false);});
test('existing request source hydrates its captured version and revision rather than using current source metadata',()=>{const selected=capturedRequestItem({itemId:item._id,itemCode:'OLD',itemVersion:2,itemRevision:1,description:'Captured specification',uom:'KG',trackingPolicy:'LOT'});assert.equal(selected.version,2);assert.equal(selected.currentRevision,1);assert.equal(selected.content.description,'Captured specification');assert.equal(selectionValidity('items',selected,item).valid,false);});
test('vendor hydration retains identity and rejects deactivated or foreign replacement sources',()=>{assert.equal(selectionValidity('vendors',item,{...item,version:10}).valid,true);assert.equal(selectionValidity('vendors',item,{...item,_id:'foreign'}).valid,false);assert.equal(selectionValidity('vendors',item,{...item,eligible:false}).valid,false);});
test('late obsolete source results cannot overwrite newer results even if transport ignores abort',async()=>{const calls=[],states=[],loader=createLatestOptions((path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject})),state=>states.push(state));const first=loader.load('/old'),second=loader.load('/new');assert.equal(calls[0].options.signal.aborted,true);calls[1].resolve({data:[item],page:{nextCursor:'next'}});await second;calls[0].resolve({data:[{_id:'obsolete'}]});await first;assert.equal(states.at(-1).data[0]._id,item._id);assert.equal(states.at(-1).page.nextCursor,'next');});
test('late obsolete errors and cancelled reads never replace a completed selection page',async()=>{const calls=[],states=[],loader=createLatestOptions(()=>new Promise((resolve,reject)=>calls.push({resolve,reject})),state=>states.push(state));const first=loader.load('/old'),second=loader.load('/new');calls[1].resolve({data:[item]});await second;calls[0].reject(Error('late error'));await first;assert.equal(states.at(-1).error,undefined);const third=loader.load('/cancelled');loader.cancel();calls[2].resolve({data:[{_id:'cancelled'}]});await third;assert.notEqual(states.at(-1).data?.[0]?._id,'cancelled');});
test('production reserve binds both receipt and stock versions and fails closed on stale or held stock',()=>{const captured={receiptId:item._id,receiptVersion:5,version:2,canAllocate:true};assert.equal(sourceVersionMatches(captured,{...captured}),true);assert.equal(sourceVersionMatches(captured,{...captured,version:3}),false);assert.equal(sourceVersionMatches(captured,{...captured,canAllocate:false}),false);assert.match(stockOptionsPath({itemId:item._id,itemRevision:2},{q:'LOT/A'}),/itemRevision=2&q=LOT%2FA&limit=25/);});
test('selected stock evidence rejects transient list data, other receipt data, loading and errors without inventing current availability',()=>{
  const selected={receiptId:item._id,version:2,receiptVersion:5,canAllocate:true,receipt:{uom:'KG',lotNumber:'LOT-A',heatNumber:'HEAT-A'},units:[]};
  for(const resource of [{data:[selected]},{data:{...selected,receiptId:'other-receipt'}},{data:selected,loading:true},{data:selected,error:{status:503}},{data:{...selected,receipt:undefined}}])assert.equal(currentStockEvidence(selected,resource),null);
  assert.equal(currentStockEvidence(selected,{data:selected}),selected);
  const held={...selected,canAllocate:false,eligibleQuantity:'0'};
  assert.equal(currentStockEvidence(selected,{data:held}),held);
  assert.equal(sourceVersionMatches(selected,held),false);
});
test('stock command eligibility requires actual positive integer receipt and stock authority versions',()=>{
  const valid={receiptId:item._id,version:2,receiptVersion:5,canAllocate:true};
  for(const value of [undefined,null,0,-1,1.5,'2'])for(const field of ['version','receiptVersion'])assert.equal(sourceVersionMatches({...valid,[field]:value},{...valid,[field]:value}),false);
  assert.equal(sourceVersionMatches({canAllocate:true},{canAllocate:true}),false);
});
test('output attribution offers only identities actually consumed by this execution from this receipt',()=>{
  const source={receiptId:'receipt-a',units:[{serial:'OWN',status:'CONSUMED',executionId:'job-a'},{serial:'FOREIGN',status:'CONSUMED',executionId:'job-b'},{serial:'AVAILABLE',status:'AVAILABLE'},{serial:'UNBOUND',status:'CONSUMED',executionId:'job-a'}]},view={_id:'job-a',reservations:[{receiptId:'receipt-a',executionId:'job-a',status:'CONSUMED',serials:['OWN']},{receiptId:'receipt-a',executionId:'job-b',status:'CONSUMED',serials:['FOREIGN']},{receiptId:'receipt-a',executionId:'job-a',status:'RELEASED',serials:['UNBOUND']},{receiptId:'other-receipt',executionId:'job-a',status:'CONSUMED',serials:['UNBOUND']}]};
  assert.deepEqual(consumedSourceIdentities(source,view),['OWN']);
});
test('production attribution preserves explicit exact source quantities and identities, including empty process loss',()=>{const sources=[{receiptId:'lot',source:{trackingPolicy:'LOT'}},{receiptId:'serial',source:{trackingPolicy:'SERIAL'}}];assert.deepEqual(attributionSources(sources,{quantity0:'2.500001',quantity1:'2',serials1:['S-1','S-2']}),[{receiptId:'lot',quantity:'2.500001'},{receiptId:'serial',quantity:'2',serials:['S-1','S-2']}]);assert.deepEqual(attributionSources(sources,{quantity0:'0.000000',quantity1:''}),[]);assert.deepEqual(executionCommand({version:7},{reason:' Actual evidence '},'same-key',{quantity:'2.500001'}),{expectedVersion:7,reason:'Actual evidence',idempotencyKey:'same-key',quantity:'2.500001'});});
test('required labor indices preserve explicit operation identity and omit absent policy in legacy planning',()=>{assert.deepEqual(requiredLaborIndices('3, 0\n4'),[0,3,4]);for(const invalid of ['1,1','-1','1.5','50','00','A'])assert.throws(()=>requiredLaborIndices(invalid));const order={_id:'order',version:2,snapshot:{lines:[{uom:'UN'}]}},values={lineIndex:'0',quantities:'6 4'};assert.equal(Object.hasOwn(planCommand(order,values,'key'),'requiredLaborOperationIndices'),false);assert.deepEqual(planCommand(order,{...values,requiredLaborOperationIndices:'0,3'},'key').requiredLaborOperationIndices,[0,3]);});
test('required labor sequence chooses routing operation40 after10 and does not invent further required entries',()=>{assert.equal(nextLaborIndex({requiredLaborOperationIndices:[0,3],laborCount:0}),0);assert.equal(nextLaborIndex({requiredLaborOperationIndices:[0,3],laborCount:1}),3);assert.equal(nextLaborIndex({requiredLaborOperationIndices:[0,3],laborCount:2}),undefined);assert.equal(nextLaborIndex({laborCount:2}),2);});
test('labor command keeps exact elapsed window distinct from explicitly reported active work and omits absent active field',()=>{const wo={version:8,requiredLaborOperationIndices:[0,3],laborCount:1},values={startedAt:'2026-01-01T00:00:00.000Z',endedAt:'2026-01-02T06:00:00.000Z',durationMs:'108000000',activeDurationMs:'54000000',evidence:'Actual work with excluded breaks'};assert.equal(laborCommand(wo,values,'key','operator').durationMs,108000000);assert.equal(laborCommand(wo,values,'key','operator').activeDurationMs,54000000);assert.equal(laborCommand(wo,values,'key','operator').operationIndex,3);assert.equal(Object.hasOwn(laborCommand(wo,{...values,activeDurationMs:''},'key','operator'),'activeDurationMs'),false);assert.equal(laborHours(54000000),'15');});
