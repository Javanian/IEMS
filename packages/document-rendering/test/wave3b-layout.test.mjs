import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { createSnapshot, renderPdf } from '../src/index.mjs';
const scope={tenantId:'tenant-a',legalEntityId:'entity-a',plantId:'plant-a'};
test('v2 readable repeated headers footers exact totals and legacy v1 stay bounded',async()=>{
 const dir=`evidence/wave3b/layout-${randomUUID()}`;await fs.mkdir(dir,{recursive:true});
 const source={_id:'stress-reference',version:1,...scope,snapshot:{currency:'USD',total:'101.00',taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:Array.from({length:100},(_,i)=>({description:`Long item ${i+1} `+'description '.repeat(15),quantity:'1.005',unitPrice:'1.00',currency:'USD',uom:'EA'}))}};
 const snapshot=createSnapshot('purchaseOrder',scope,source);assert.equal(snapshot.template.version,2);
 const old=createSnapshot('purchaseOrder',scope,source,{templateVersion:1});assert.equal(old.template.version,1);assert.notEqual(old.contentHash,snapshot.contentHash);await renderPdf(old);
 const pdf=await renderPdf(snapshot);assert.deepEqual(await renderPdf(snapshot),pdf);await fs.writeFile(`${dir}/stress.pdf`,pdf);
 const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;const metrics=[];
 for(let i=1;i<=doc.numPages;i++){
  const page=await doc.getPage(i),viewport=page.getViewport({scale:1.5}),items=(await page.getTextContent()).items.filter(x=>x.str),text=items.map(x=>x.str).join(' ');
  assert.ok(text.includes('PURCHASE ORDER'));assert.ok(text.includes('stress-reference'));assert.ok(text.includes(`Page ${i} of ${doc.numPages}`));
  assert.equal((text.match(/Long item /g)||[]).length,(text.match(/Quantity:/g)||[]).length);
  for(const x of items){assert.ok(x.transform[4]>=47&&x.transform[4]+x.width<=550,x.str);assert.ok(x.transform[5]>40&&x.transform[5]<802,x.str);if(x.str.includes('Quantity:'))assert.ok(x.height>=12);}
  if(i===doc.numPages)assert.ok(text.includes('TOTAL: 101.00 USD'));
  const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise;await fs.writeFile(`${dir}/page-${i}.png`,canvas.toBuffer('image/png'));metrics.push({page:i,items:items.length,text});
 }
 await fs.writeFile(`${dir}/metrics.json`,JSON.stringify(metrics,null,2));console.log('WAVE3B_LAYOUT_EVIDENCE '+dir);await doc.destroy();
});
