import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getDocument } from '../../../packages/document-rendering/node_modules/pdfjs-dist/legacy/build/pdf.mjs';

export async function documentJourney({db,call,wait,click,evaluate,screenshot,check,headers,loseResponse,downloadPath}) {
 const credential=await db.collection('credentials').findOne({username:'alpha.owner'});
 const membership=await db.collection('memberships').findOne({userId:credential._id});
 const quote=await db.collection('quotes').findOne({status:'CONVERTED',accountId:{$exists:true}});
 const po=await db.collection('purchaseOrders').findOne({status:{$in:['ISSUED','CONFIRMED']}});
 const invoice=await db.collection('fulfillmentInvoices').findOne({});
 const shipment=await db.collection('fulfillmentShipments').findOne({status:'SHIPPED'});
 const cases=[['quote',quote,quote.approvals[0].revision,`quotes/${quote._id}`],['purchaseOrder',po,1,`procurement/orders/${po._id}`],['invoice',invoice,1,`fulfillment/invoices/${invoice._id}`],['shipment',shipment,1,`fulfillment/shipments/${shipment._id}`]];
 const evidence=downloadPath;
 await call('Page.setDownloadBehavior',{behavior:'allow',downloadPath:evidence.replaceAll('/','\\')});
 const results=[];
 for(const [kind,row,sourceVersion,path] of cases) {
  const key={kind,sourceId:row._id,sourceVersion};
  await call('Page.navigate',{url:`${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/${path}`});
  await wait(`document.body.innerText.includes('Source ${kind}, revision ${sourceVersion}.')`);
  // Quote history can expose several approved revisions. Select the intended immutable revision.
  const control=async label=>{await evaluate(`(()=>{const s=[...document.querySelectorAll('section')].find(s=>s.querySelector('h2')?.textContent==='Immutable issued document'&&s.textContent.includes('Source ${kind}, revision ${sourceVersion}.'));[...s.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}&&!b.disabled).click()})()`);};
  await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:[{role:'documentIssuer',plantIds:membership.plantIds}]}});
  await control('Issue immutable PDF');await wait(`document.body.innerText.includes('Access denied')`);
  assert.equal(await db.collection('documentIntents').countDocuments(key),0);
  await screenshot(`wave3e-${kind}-source-forbidden`);
  await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:membership.roles}});
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await control('Issue immutable PDF');await wait(`document.querySelector('[role=alert]')`);
  assert.equal(await db.collection('documentIntents').countDocuments(key),0);
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  const lost=await loseResponse('*/api/documents/issues',()=>control('Issue immutable PDF'),async({command,receipt})=>{
   assert.deepEqual(command,key);assert.equal((await db.collection('documentIntents').findOne({_id:receipt.data._id})).state,'READY');
   assert.equal(await db.collection('documentAudit').countDocuments({sourceId:row._id,sourceVersion}),1);
  });
  await wait(`document.querySelector('[role=alert]')`);await control('Issue immutable PDF');
  await wait(`document.body.innerText.includes('${lost.receipt.data.pdfHash}')`);
  const metadata=lost.receipt.data;
  assert.equal(metadata.sourceId,row._id);assert.equal(metadata.sourceVersion,sourceVersion);
  await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:[{role:'documentIssuer',plantIds:membership.plantIds}]}});
  await control('Download verified PDF');await wait(`document.body.innerText.includes('Access denied')`);
  const denied=await fetch(`http://127.0.0.1:4313/api/documents/issues/${metadata._id}`,{headers});assert.equal(denied.status,403);
  assert.equal((await readdir(evidence)).includes(`${kind}-${metadata._id}.pdf`),false);
  await db.collection('memberships').updateOne({_id:membership._id},{$set:{roles:membership.roles}});
  await control('Download verified PDF');
  const filename=`${kind}-${metadata._id}.pdf`;
  for(let n=0;n<100&&!(await readdir(evidence)).includes(filename);n++)await new Promise(r=>setTimeout(r,100));
  const bytes=await readFile(`${evidence}/${filename}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),metadata.pdfHash);
  const pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
  let text='';for(let n=1;n<=pdf.numPages;n++)text+=(await(await pdf.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');
  await pdf.destroy();
  assert.ok(text.includes(row._id),'PDF source identity');
  if(metadata.snapshot.total!==undefined)assert.ok(text.includes(metadata.snapshot.total),'exact frozen total');
  for(const line of metadata.snapshot.lines||[]) { assert.ok(text.includes(line.quantity));assert.ok(text.includes(line.uom)); }
  await writeFile(`${evidence}/wave3e-${kind}-parsed.txt`,text);
  const origin=await evaluate('performance.timeOrigin');await call('Page.reload');
  await wait(`performance.timeOrigin!==${origin}&&document.body.innerText.includes('Source ${kind}, revision ${sourceVersion}.')`);
  await control('Issue immutable PDF');await wait(`document.body.innerText.includes('${metadata.pdfHash}')`);
  for(const width of [375,768,1280]) {
   await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
   assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
   await evaluate(`[...document.querySelectorAll('h2')].find(h=>h.textContent==='Immutable issued document').scrollIntoView()`);
   await screenshot(`wave3e-${kind}-${width}`);
  }
  assert.equal(await db.collection('documentIntents').countDocuments({sourceId:row._id,sourceVersion}),1);
  assert.equal(await db.collection('documentAudit').countDocuments({sourceId:row._id,sourceVersion}),1);
  assert.equal(await db.collection('documentOutbox').countDocuments({sourceId:row._id,sourceVersion,state:'PENDING'}),1);
  results.push({key,issueId:metadata._id,total:metadata.snapshot.total,pdfHash:metadata.pdfHash,contentHash:metadata.contentHash,filename,sourceDenied:true,offlineBeforeCommit:true,committedResponseLost:true,reloadedSameArtifact:true});
  check(`wave3e ${kind}: source-only authorization denial, offline recovery, committed response loss, same immutable issuance after reload, actual Chrome PDF source/exact totals/hash, three widths`);
 }
 await writeFile(`${evidence}/wave3e-documents.json`,JSON.stringify(results,null,2));
}
