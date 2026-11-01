import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const read = name => readFile(new URL(`../src/features/portfolio/${name}`, import.meta.url), 'utf8');
test('browser journeys receive the resolved evidence directory without an environment override', async () => {
 const harness = await readFile(new URL('./portfolio-browser.mjs', import.meta.url), 'utf8');
 for (const [journey, file] of [['repairJourney', 'portfolio-repair-browser.mjs'], ['documentJourney', 'portfolio-wave3e-documents-browser.mjs']]) {
  assert.match(harness, new RegExp(`${journey}\\(\\{[^\\n]*downloadPath: evidence`));
  const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
  assert.match(source, /export async function \w+\(\{[^\n]*downloadPath/);
  assert.doesNotMatch(source, /process\.env\.PORTFOLIO_EVIDENCE_DIR/);
 }
});
test('CS inbox routes isolate resource state when switching between ticket and conversation projections', async () => {
 const workspace = await read('PortfolioWorkspace.jsx');
 assert.match(workspace, /<ServiceInbox key="tickets" kind="tickets"/);
 assert.match(workspace, /<ServiceInbox key="conversations" kind="conversations"/);
});
test('source detail routes mount immutable documents only at issued boundaries', async () => {
 const quote = await read('CommercialWorkspace.jsx');
 assert.match(quote, /<DocumentIssue[^>]*kind="quote"[^>]*sourceId=\{q\._id\}[^>]*sourceVersion=\{a\.revision\}/);
 const bundled=await build({stdin:{contents:`
  import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MemoryRouter} from 'react-router-dom';
  import {PurchaseOrderAmendments} from '../src/features/portfolio/ProcurementWorkspace.jsx';
  import {issued} from '../src/features/portfolio/DocumentIssue.jsx';
  export function render(status,cohort){issued.length=0;const row={_id:'po-source',status,version:4,documentRevision:2,lineIds:[],snapshot:{lines:[]},content:{lines:[]}};renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(PurchaseOrderAmendments,{row,cohort})));return [...issued];}
 `,resolveDir:fileURLToPath(new URL('./',import.meta.url)),loader:'jsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',define:{'import.meta.env':'{}'},plugins:[{name:'issued-document-observer',setup(b){
  b.onResolve({filter:/DocumentIssue\.jsx$/},()=>({path:'document',namespace:'contract'}));
  b.onResolve({filter:/PortfolioWorkspace\.jsx$/},()=>({path:'resource',namespace:'contract'}));
  b.onLoad({filter:/.*/,namespace:'contract'},({path})=>({contents:path==='document'?`export const issued=[];export function DocumentIssue({kind,sourceId,sourceVersion}){issued.push({kind,sourceId,sourceVersion});return null;}`:`import React from 'react';export const IdentityContext=React.createContext({permissions:[]});export function useResource(){return {loading:true}};export function Resource(){return null};export function Failure(){return null};export function MutationForm(){return null};export function CommandAttemptState(){return null};`,resolveDir:fileURLToPath(new URL('../',import.meta.url))}));
 }}]});
 const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
 for(const [cohort,kind] of [['LEGACY','purchaseOrder'],['CATALOG','catalogPurchaseOrder']]){
  for(const status of ['DRAFT','APPROVED'])assert.deepEqual(module.exports.render(status,cohort),[]);
  for(const status of ['ISSUED','CONFIRMED'])assert.deepEqual(module.exports.render(status,cohort),[1,2].map(sourceVersion=>({kind,sourceId:'po-source',sourceVersion})));
 }
 const fulfillment = await read('FulfillmentWorkspace.jsx');
 assert.match(fulfillment, /<DocumentIssue[^>]*kind="invoice"/);
 assert.match(fulfillment, /row.status === 'SHIPPED'/);
 assert.match(fulfillment, /<DocumentIssue[^>]*kind="shipment"/);
});
test('document panel names source identity and explicit issuance state', async () => {
 const panel = await read('DocumentIssue.jsx');
 assert.match(panel, /Source ID: \{sourceId\}/);
 assert.match(panel, /Issued artifact loaded/);
 assert.match(panel, /No artifact loaded/);
 assert.match(panel, /Non-financial shipment document/);
});
test('repair deposit guidance distinguishes the frozen maximum from start requirement', async () => {
 assert.match(await read('RepairWorkspace.jsx'), /Maximum cumulative deposits[^\n]*scope\?\.snapshot\?\.total/);
});
