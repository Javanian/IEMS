import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { purchasedBlockerHints,purchasedDocumentAccess,purchasedHint,purchasedOrderUrl,purchasedReservationStatus,purchasedUnitLabels,releasePurchasedCommand,reservePurchasedCommand,shipPurchasedCommand } from '../src/features/portfolio/purchased-fulfillment.mjs';

function fixture(policy='SERIAL') {return {version:7,salesOrder:{_id:'order',version:1},lines:[{lineIndex:0,supported:true,catalogBinding:{itemSnapshot:{content:{trackingPolicy:policy}}}},{lineIndex:1,supported:false}],reservations:[{_id:'claim',version:4,lineIndex:0,receiptId:'receipt'}],stockSources:[{receiptId:'receipt',receiptVersion:3,version:9,units:[{_id:'unit-a',serial:'REAL-A'},{_id:'unit-b',serial:'REAL-B'}]}]};}
test('actual purchased shipment, invoice and payment detail hide account navigation unless CRM read is granted',async()=>{
  const result=await build({
    stdin:{contents:`
      import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {MemoryRouter,Routes,Route} from 'react-router-dom';
      import {FulfillmentDetail} from '../src/features/portfolio/FulfillmentWorkspace.jsx';
      import {IdentityContext,setKind,calls} from '../src/features/portfolio/PortfolioWorkspace.jsx';
      export function render(kind,permissions){setKind(kind);calls.length=0;return {html:renderToStaticMarkup(
        React.createElement(MemoryRouter,{initialEntries:['/portfolio/fulfillment/'+kind+'/record']},
          React.createElement(IdentityContext.Provider,{value:permissions===undefined?{}:{permissions}},
            React.createElement(Routes,null,React.createElement(Route,{path:'/portfolio/fulfillment/:kind/:id',element:React.createElement(FulfillmentDetail,{kind})}))))),calls:[...calls]};}
    `,resolveDir:fileURLToPath(new URL('./',import.meta.url)),loader:'jsx'},
    bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',define:{'import.meta.env':'{}'},
    plugins:[{name:'fulfillment-read-fixture',setup(bundler){
      bundler.onResolve({filter:/PortfolioWorkspace\.jsx$/},()=>({path:'fulfillment-resources',namespace:'fixture'}));
      bundler.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
        import React from 'react';
        export const IdentityContext=React.createContext(null),calls=[];let kind;
        export const setKind=value=>{kind=value;};
        export function useResource(path){calls.push(path);const delivery={version:1,shipmentId:'record',shipmentVersion:1,shipmentStatus:'SHIPPED',status:'NOT_DELIVERED',serials:[],remainingSerials:[],confirmations:[],shippedQuantity:'1',deliveredQuantity:'0',remainingQuantity:'1',remainingUnserializedQuantity:'1',uom:'UN',canConfirm:false};
          const row={_id:'record',reference:'ACTUAL-DETAIL',version:1,accountId:'account-record',salesOrderId:'order-record',schema:{shipments:'PURCHASED_SHIPMENT_V1',invoices:'PURCHASED_INVOICE_V1',payments:'PURCHASED_PAYMENT_V1'}[kind],status:kind==='invoices'?'PAID':kind==='shipments'?'SHIPPED':'ALLOCATED',quantity:'1',uom:'UN',currency:'USD',amount:'0.10',total:'0.10',paidAmount:'0.10',outstandingAmount:'0.00',lines:[],allocations:[],sources:[],createdAt:'2026-10-26T00:00:00.000Z'};
          return {data:path.startsWith('/api/deliveries/')?delivery:row,reload(){}};}
        export function Resource({resource,children}){return children(resource);}
        export function Failure(){return null;}
      `,resolveDir:fileURLToPath(new URL('../',import.meta.url))}));
    }}],
  });
  const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  for(const kind of ['shipments','invoices','payments']){
    for(const permissions of [undefined,[],['fulfillment.read','catalog.stock.read']]){
      const reader=module.exports.render(kind,permissions);
      assert.match(reader.html,/ACTUAL-DETAIL/);assert.doesNotMatch(reader.html,/class="pf-error"/);
      assert.doesNotMatch(reader.html,/href="\/portfolio\/accounts\/account-record"/);
      assert.match(reader.html,/href="\/portfolio\/fulfillment\/orders\/order-record\?catalog=1"/);
      assert.equal(reader.calls.some(path=>path.startsWith('/api/crm/')),false);
    }
    const authorized=module.exports.render(kind,['fulfillment.read','catalog.stock.read','crm.read']);
    assert.match(authorized.html,/href="\/portfolio\/accounts\/account-record"[^>]*>Open account<\/a>/);
  }
});
test('overlapping line and reserve blockers produce one stable copy of each human hint without dropping distinct reasons',()=>{const codes=['PURCHASED_LINE_UNSUPPORTED','PURCHASED_ITEM_CHANGED','PURCHASED_LINE_UNSUPPORTED','UNKNOWN_CODE','PURCHASED_ITEM_CHANGED'],before=[...codes],unsupported=purchasedHint({code:'PURCHASED_LINE_UNSUPPORTED'}),changed=purchasedHint({code:'PURCHASED_ITEM_CHANGED'});assert.deepEqual(purchasedBlockerHints(codes),[unsupported,changed]);assert.deepEqual(codes,before);assert.deepEqual(purchasedBlockerHints(['PURCHASED_ITEM_CHANGED','PURCHASED_LINE_UNSUPPORTED']),[changed,unsupported]);assert.deepEqual(purchasedBlockerHints(['UNKNOWN_CODE']),[]);assert.deepEqual(purchasedBlockerHints(),[]);});
test('typed fulfillment document issue and download require their separate real grants, with no reader or issuer inference',()=>{for(const permissions of [undefined,null,[],['fulfillment.read'],['catalog.stock.read','fulfillment.read'],['document.issue','document.read']]){const access=purchasedDocumentAccess(permissions);assert.match(access.issueBlockedReason,/permission/);assert.match(access.downloadBlockedReason,/permission/);}const issueOnly=purchasedDocumentAccess(['fulfillment.read','document.issue']);assert.equal(issueOnly.issueBlockedReason,'');assert.match(issueOnly.downloadBlockedReason,/read documents/);const readOnly=purchasedDocumentAccess(['fulfillment.read','document.read']);assert.match(readOnly.issueBlockedReason,/issue documents/);assert.equal(readOnly.downloadBlockedReason,'');assert.deepEqual(purchasedDocumentAccess(['fulfillment.read','document.issue','document.read']),{issueBlockedReason:'',downloadBlockedReason:''});});
test('purchased serial reservation captures actual UUIDs and shared stock CAS without invented unit versions',()=>{const view=fixture(),selected=['unit-b'],body=reservePurchasedCommand(view,view.stockSources[0],{lineIndex:'0',quantity:'1',unitIds:selected,reason:' Explicit selection '},'key');assert.deepEqual(body,{expectedVersion:7,expectedSalesOrderVersion:1,lineIndex:0,receiptId:'receipt',expectedReceiptVersion:3,expectedStockVersion:9,quantity:'1',unitIds:['unit-b'],reason:'Explicit selection',idempotencyKey:'key'});selected.push('unit-a');assert.deepEqual(body.unitIds,['unit-b']);assert.equal(Object.hasOwn(body,'serials'),false);});
test('LOT command preserves exact six-place string and omits serial identity fields',()=>{const view=fixture('LOT'),body=reservePurchasedCommand(view,view.stockSources[0],{lineIndex:'0',quantity:'2.500001',unitIds:['ignored'],reason:'Actual lot'},'key');assert.equal(body.quantity,'2.500001');assert.equal(Object.hasOwn(body,'unitIds'),false);assert.equal(Object.hasOwn(body,'serials'),false);});
test('release captures latest shared stock proof and only the whole remainder command, including held stock',()=>{const view=fixture();view.stockSources[0].canAllocate=false;const body=releasePurchasedCommand(view,view.reservations[0],{quantity:'99',unitIds:['unit-a'],reason:'Held remainder'},'key');assert.deepEqual(body,{expectedVersion:7,expectedReservationVersion:4,expectedReceiptVersion:3,expectedStockVersion:9,reason:'Held remainder',idempotencyKey:'key'});});
test('partial serial dispatch uses selected reservation identities and exact line-bound source CAS',()=>{const view=fixture(),body=shipPurchasedCommand(view,{lineIndex:'0',reservationId0:'claim',quantity0:'1',unitIds0:['unit-b'],reference:'DISPATCH-1',reason:'Actual dispatch'},1,'key');assert.deepEqual(body.sources,[{reservationId:'claim',expectedReservationVersion:4,expectedReceiptVersion:3,expectedStockVersion:9,quantity:'1',unitIds:['unit-b']}]);assert.equal(body.reference,'DISPATCH-1');assert.equal(body.expectedSalesOrderVersion,1);});
test('unsupported line, malformed UUID array, repeated claims and missing current evidence fail instead of constructing fallback sources',()=>{const view=fixture(),values={lineIndex:'0',quantity:'1',reason:'Actual selection',unitIds:'REAL-A'};assert.throws(()=>reservePurchasedCommand(view,view.stockSources[0],values,'key'),{code:'INVALID_UNITS'});assert.throws(()=>reservePurchasedCommand(view,view.stockSources[0],{...values,lineIndex:'1'},'key'));assert.throws(()=>shipPurchasedCommand(view,{...values,reservationId0:'claim',reservationId1:'claim',unitIds0:[],unitIds1:[]},2,'key'));assert.throws(()=>shipPurchasedCommand(view,values,21,'key'));assert.throws(()=>releasePurchasedCommand({...view,stockSources:[]},view.reservations[0],values,'key'));});
test('shipment identity labels come from immutable actual stock-unit UUIDs, not similarly named registry or serial values',()=>{const view=fixture(),source=view.stockSources[0];assert.deepEqual(purchasedUnitLabels(source,['unit-b']),[source.units[1]]);assert.deepEqual(purchasedUnitLabels(source,['REAL-B']),[]);assert.deepEqual(purchasedUnitLabels(undefined,['unit-b']),[]);});
test('released reservation copy preserves shipped custody meaning and source withdrawal recovery is actionable',()=>{assert.equal(purchasedReservationStatus('RELEASED'),'Released unshipped remainder');assert.match(purchasedHint({code:'STOCK_ENCUMBERED'}),/release an unshipped/);assert.match(purchasedHint({code:'PURCHASED_LINE_UNSUPPORTED'}),/Manufactured/);assert.match(purchasedHint({code:'CATALOG_DEPENDENCY_CHANGED'}),/recorded shipments/);assert.match(purchasedHint({code:'PURCHASED_FULFILLMENT_MODE_CONFLICT'}),/cannot mix/);assert.equal(purchasedOrderUrl('order'),'/portfolio/fulfillment/orders/order?catalog=1');});
