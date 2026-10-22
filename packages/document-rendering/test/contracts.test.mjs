import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { createSnapshot, renderPdf, contentHash } from '../src/index.mjs';
before(() => fs.mkdir('evidence/wave3/c-20261022-01', { recursive: true }));
const scope = {tenantId:'tenant-a',legalEntityId:'entity-a',plantId:'plant-a'};
const base = () => ({_id:'source-1',version:1,...scope,snapshot:{currency:'USD',total:'1.01',taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'Seal',quantity:'1.005',unitPrice:'1.00',currency:'USD',uom:'EA'}]}});
test('all four document shapes preserve exact scales; unsupported policies scope and numeric inputs are refused',async()=>{
  for (const kind of ['quote','purchaseOrder','invoice']) {
    const raw=base(), input=kind==='invoice'?{...raw,...raw.snapshot}:raw;
    const snapshot=createSnapshot(kind,scope,input); assert.equal(snapshot.total,'1.01');
    const pdf=await renderPdf(snapshot); const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;
    const text=(await (await doc.getPage(1)).getTextContent()).items.map(x=>x.str).join(' ');
    assert.ok(text.includes('1.005')); assert.ok(text.includes('1.01')); await doc.destroy();
    await fs.writeFile(`evidence/wave3/c-20261022-01/${kind}.pdf`,pdf);
  }
  const shipment=createSnapshot('shipment',scope,{_id:'ship-1',version:1,...scope,salesOrderId:'so-1',lineIndex:2,quantity:'0.000001',uom:'KG',reference:'Dispatch-001'});
  assert.equal(shipment.total,undefined); assert.equal(shipment.lines[0].quantity,'0.000001');
  await fs.writeFile('evidence/wave3/c-20261022-01/shipment.pdf',await renderPdf(shipment));
  for (const [currency,price] of [['JPY','999999999999999999'],['KWD','9007199254740993.123'],['IDR','0.10']]) {
    const raw=base(); raw.snapshot={...raw.snapshot,currency,total:price,lines:[{description:'Exact',quantity:'1',unitPrice:price,currency,uom:'KG'}]};
    assert.equal(createSnapshot('quote',scope,raw).total,price);
  }
  const mutations=[s=>s.snapshot.total='1.00',s=>s.snapshot.lines[0].quantity=1.005,s=>s.snapshot.lines[0].currency='EUR',s=>s.tenantId='other',s=>s.snapshot.taxPolicy='TAX',s=>s.snapshot.lines[0].uom='kg',s=>s.snapshot.lines[0].description='非ASCII',s=>s.version=0];
  for (const mutate of mutations) {const raw=base();mutate(raw);assert.throws(()=>createSnapshot('quote',scope,raw));}
  const original=createSnapshot('quote',scope,base()); const altered=structuredClone(original);altered.total='0.00';
  await assert.rejects(renderPdf(altered),/INTEGRITY/);
  altered.contentHash=contentHash(Object.fromEntries(Object.entries(altered).filter(([k])=>k!=='contentHash')));
  await assert.rejects(renderPdf(altered),/MISMATCH/);
});
test('multipage PDF stays inside printable bounds and rasterizes every page',async()=>{
  const raw=base();raw.snapshot.lines=Array.from({length:100},(_,i)=>({...raw.snapshot.lines[0],description:`Long item ${i+1} `+'description '.repeat(15)}));raw.snapshot.total='101.00';
  const snapshot=createSnapshot('purchaseOrder',scope,raw),pdf=await renderPdf(snapshot);
  const dir='evidence/wave3/c-20261022-01';await fs.writeFile(`${dir}/multipage.pdf`,pdf);
  const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;
  assert.ok(doc.numPages>1);let items=0;
  for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i),viewport=page.getViewport({scale:1});
    const pageText=(await page.getTextContent()).items.map(x=>x.str).join(' ');
    assert.equal((pageText.match(/Long item /g)||[]).length,(pageText.match(/Quantity:/g)||[]).length,'item must not split across pages');
    for(const item of (await page.getTextContent()).items){if(!item.str)continue;items++;assert.ok(item.transform[4]>=47&&item.transform[4]+item.width<=viewport.width-45,`page ${i} x ${item.str}`);assert.ok(item.transform[5]>40&&item.transform[5]<viewport.height-40,`page ${i} y ${item.str}`);}
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise;
    await fs.writeFile(`${dir}/multipage-${i}.png`,canvas.toBuffer('image/png'));
  }
  await fs.writeFile(`${dir}/visual-metrics.json`,JSON.stringify({pages:doc.numPages,items,allPagesRasterized:true,boundsChecked:true},null,2));await doc.destroy();
});
