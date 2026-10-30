import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';
import { chromium } from 'file:///C:/Users/Admin/.paperclip/instances/default/tools/t-project/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const workspace = process.argv[2] || 'Operations', output = process.argv[3];
if (!output || !['Operations','Workforce','Voice'].includes(workspace)) throw new Error('Usage: node browser-smoke.mjs Operations|Workforce|Voice evidence-directory');
await mkdir(output,{recursive:true});
const root = resolve('apps/web'), subject = '11111111-1111-4111-8111-111111111111';
process.chdir(root);
const server = await createServer({root,plugins:[{name:'owned-inspection-page',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(!req.url.startsWith('/__operations_inspection')) return next();
  const html=`<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="inspection"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {IdentityContext} from '/src/features/portfolio/PortfolioWorkspace.jsx';
import {${workspace}Workspace} from '/src/features/portfolio/${workspace}Workspace.jsx';
import '/src/index.css';
createRoot(document.getElementById('inspection')).render(React.createElement(BrowserRouter,null,React.createElement(IdentityContext.Provider,{value:{user:{id:'${subject}'},permissions:['workforce.read','workforce.configure','workforce.consent','workforce.challenge','workforce.verify','operations.configure','operations.enqueue','operations.publish','operations.recover']}},React.createElement('main',{className:'portfolio-root pf-workspace pf-main'},React.createElement(${workspace}Workspace)))));
</script></body></html>`;
  res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,html));
});}}],server:{host:'127.0.0.1',port:0}});
let browser;const observations=[];
try {
 await server.listen();browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/portfolio-api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const record={id:subject,version:1,status:'RELEASED',quantity:'12.000000',uom:'EA',updatedAt:'2026-10-30T12:00:00.000Z',ageDays:1,stageAgeDays:1};
  const metric={status:'AVAILABLE',total:1,completeness:'COMPLETE_QUERY',freshness:{status:'STALE',observedAt:record.updatedAt},quantities:{buckets:[{quantity:'12.000000',uom:'EA'}]},stages:[{stage:'RELEASED',count:1,oldestDaysInStage:1,oldestDaysSinceUpdate:1,missingStageTimes:0}],records:[record],nextCursor:null};
  let data;
  if(path.endsWith('/dashboard'))data={observedAt:'2026-10-31T00:00:00.000Z',metrics:Object.fromEntries(['orders','production','shipments','invoices','receipts'].map(k=>[k,metric])),warnings:[],legacy:{NFC:{status:'NO_DATA',reason:'ADAPTER_NOT_CONFIGURED',samples:[]}},reportingCoverage:{status:'NO_DATA'}};
  else if(path.includes('/drilldown/'))data=metric;
  else if(path.endsWith('/capabilities'))data={configured:true,faceVerification:false};
  else if(path.includes('/operators/'))data={resourceId:subject,version:1,pinConfigured:true,nfcConfigured:false,consent:{active:false},updatedAt:record.updatedAt};
  else if(path.endsWith('/voice/zones'))data=[];
  else data={};
  await route.fulfill({contentType:'application/json',body:JSON.stringify({data})});
 });
 for(const width of [1440,375]) {
  await page.setViewportSize({width,height:1000});await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__operations_inspection`);
  await page.getByRole('heading',{level:1}).waitFor();
  if(workspace==='Workforce'){await page.getByLabel(/^Operator ID/).fill(subject);await page.getByRole('button',{name:'Open operator',exact:true}).click();await page.getByRole('heading',{name:'Operator verification',exact:true}).waitFor();}
  if(workspace==='Operations') await page.getByRole('table',{name:'Production records',exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button').first().focus();assert(await page.evaluate(()=>document.activeElement.tagName==='BUTTON'));
  await page.screenshot({path:resolve(output,`${workspace}-${width}.png`),fullPage:true});observations.push({workspace,width,noDocumentOverflow:true,buttonKeyboardFocus:true,fixture:'SYNTHETIC_UI_ONLY'});
 }
 assert.deepEqual(errors,[]);await writeFile(resolve(output,`${workspace}-inspection.json`),JSON.stringify({observations,errors},null,2));
 console.log(JSON.stringify(observations));
} finally {await browser?.close();await server.close();}
