import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
 const po = await read('ProcurementWorkspace.jsx');
 assert.match(po, /\['ISSUED','CONFIRMED'\]\.includes\(row.status\)/);
 assert.match(po, /<DocumentIssue[^>]*kind="purchaseOrder"/);
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
