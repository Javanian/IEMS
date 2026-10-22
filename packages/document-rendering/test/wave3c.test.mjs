import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot, renderPdf, contentHash, createIssuer } from '../src/index.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const evidence = path.resolve('evidence/wave3c', 'c-'+randomUUID());
await fs.mkdir(evidence,{recursive:true});
const scope = { tenantId:'wave3c', legalEntityId:'entity', plantId:'plant' };
const source = (currency='USD', price='0.01', beforeAmount='0.01', afterAmount='0.01', amount='0.00') => ({ _id:randomUUID(), ...scope, version:1, currency, taxPolicy:'NO_TAX', roundingPolicy:'CUMULATIVE_HALF_UP', total:amount, lines:[{ description:'Split invoice exact ledger', quantity:'0.5', uom:'EA', unitPrice:price, currency, amount, rounding:{ sourceId:'sales-order', lineIndex:0, beforeQuantity:'0.5', afterQuantity:'1', beforeAmount, afterAmount } }] });
test('cumulative split preserves exact source zero instead of independently rounding it', async () => {
  const s = createSnapshot('invoice',scope,source());
  assert.equal(s.lines[0].amount,'0.00'); assert.equal(s.lines[0].rounding.beforeQuantity,'0.5');
  assert.ok(Object.isFrozen(s.lines[0].rounding));
  const pdf = await renderPdf(s), parsed = await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;
  const text = (await (await parsed.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');
  assert.match(text,/0\.00 USD/); assert.match(text,/cumulative/i); await parsed.destroy();
});

test('zero quantity provenance permits fixed six-place zero', () => {
 const r=source(); r.total='0.01';r.lines[0].amount='0.01';Object.assign(r.lines[0].rounding,{beforeQuantity:'0.000000',afterQuantity:'0.500000',beforeAmount:'0.00',afterAmount:'0.01'});
 assert.equal(createSnapshot('invoice',scope,r).total,'0.01');
});
test('same source line rejects overlapping cumulative intervals', () => {
 const row=source(); row.lines.push(structuredClone(row.lines[0]));
 assert.throws(()=>createSnapshot('invoice',scope,row),/INVALID_PROVENANCE/);
});
test('strict financial and provenance rejection including rehashed forgery', async () => {
 for (const mutate of [
  r=>r.total='0.01', r=>r.lines[0].amount='0.01', r=>delete r.lines[0].amount,
  r=>delete r.lines[0].rounding, r=>r.lines[0].rounding.beforeQuantity='0.4',
  r=>r.lines[0].rounding.afterQuantity='0.9', r=>r.lines[0].rounding.beforeAmount='0.00',
  r=>r.lines[0].rounding.afterAmount='0.02', r=>r.lines[0].rounding.lineIndex=-1,
  r=>r.lines[0].rounding.sourceId='', r=>r.lines[0].rounding.extra='leak',
  r=>r.lines[0].rounding.beforeQuantity='-0.5', r=>r.lines[0].rounding.beforeQuantity=0.5,
  r=>r.lines[0].currency='JPY', r=>r.lines[0].quantity='0.5000001',
 ]) { const r=source(); mutate(r); assert.throws(()=>createSnapshot('invoice',scope,r)); }
 const ordinary=source(); ordinary.roundingPolicy='LINE_HALF_UP';
 assert.throws(()=>createSnapshot('invoice',scope,ordinary),/INVALID_PROVENANCE/);
 delete ordinary.lines[0].rounding;
 assert.throws(()=>createSnapshot('invoice',scope,ordinary),/LINE_AMOUNT_MISMATCH/);
 assert.throws(()=>createSnapshot('quote',scope,{...source(),snapshot:source()}),/INVALID_POLICY/);
 const forged=structuredClone(createSnapshot('invoice',scope,source()));
 forged.lines[0].rounding.afterAmount='0.02'; const {contentHash:_,...body}=forged; forged.contentHash=contentHash(body);
 await assert.rejects(renderPdf(forged),/INVALID_PROVENANCE/);
});
test('JPY KWD high precision and first/second split preserve amounts with parsed PDF evidence', async () => {
 const cases=[['USD','0.01','0.01','0.01','0.00'],['JPY','1','1','1','0'],['KWD','0.001','0.001','0.001','0.000'],['KWD','9007199254740993.123','4503599627370496.562','9007199254740993.123','4503599627370496.561']];
 const results=[];
 for(const [currency,price,before,after,amount] of cases) {
  const second=source(currency,price,before,after,amount), first=source(currency,price,before,after,before);
  Object.assign(first.lines[0].rounding,{beforeQuantity:'0',afterQuantity:'0.5',beforeAmount:currency==='JPY'?'0':currency==='KWD'?'0.000':'0.00',afterAmount:before});
  for(const [part,row] of [['first',first],['second',second]]) {
   const snapshot=createSnapshot('invoice',scope,row),pdf=await renderPdf(snapshot);
   const parsed=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;
   const text=(await (await parsed.getPage(1)).getTextContent()).items.map(i=>i.str).join(' '); await parsed.destroy();
   assert.ok(text.includes(`${row.total} ${currency}`)); assert.ok(text.includes('Cumulative'));
   const name=`${results.length}-${currency}-${part}`; await fs.writeFile(path.join(evidence,name+'.pdf'),pdf);
   results.push({name,total:row.total,text,snapshotHash:snapshot.contentHash,pdfHash:contentHash([...pdf])});
  }
 }
 const tiny=source('USD','9007199254740993.01','0.00','9007199254.74','9007199254.74');
 tiny.lines[0].quantity='0.000001'; Object.assign(tiny.lines[0].rounding,{beforeQuantity:'0',afterQuantity:'0.000001'});
 assert.equal(createSnapshot('invoice',scope,tiny).total,'9007199254.74');
 const repair={...source(),roundingPolicy:'LINE_HALF_UP',total:'1.25',paymentSecret:'never copied',lines:[{description:'Repair labor',quantity:'1.25',uom:'HOUR',unitPrice:'1.00',currency:'USD',amount:'1.25'}]};
 const safe=createSnapshot('invoice',scope,repair); assert.equal(safe.total,'1.25'); assert.ok(!JSON.stringify(safe).includes('paymentSecret')); await renderPdf(safe);
 await fs.writeFile(path.join(evidence,'parsed.json'),JSON.stringify(results,null,2));
 console.log('Wave3c evidence:',evidence);
});
test('real owned Mongo cumulative issuance replay validates exact immutable source amounts', async () => {
 const run=randomUUID().replaceAll('-',''), dbName='owned_document_'+run, root=path.resolve('.runtime',run);
 await fs.mkdir(root,{recursive:true});
 const binary=process.env.MONGOMS_SYSTEM_BINARY;
 const repl=await MongoMemoryReplSet.create({binary:{systemBinary:binary,version:'7.0.14'},instanceOpts:[{dbPath:root}],replSet:{count:1,storageEngine:'wiredTiger',ip:'127.0.0.1'}});
 let client=new MongoClient(repl.getUri()); await client.connect(); let db=client.db(dbName);
 const owner={_id:'owner',run,dbName}; await db.collection('ownership').insertOne(owner);
 try {
  assert.deepEqual(await db.collection('ownership').findOne({_id:'owner'}),owner);
  let issuer=await createIssuer({client,db}); const snapshot=createSnapshot('invoice',scope,source());
  const receipts=await Promise.all(Array.from({length:8},()=>issuer.issue(scope,snapshot)));
  assert.equal(new Set(receipts.map(r=>r._id)).size,1);
  const first=receipts[0], original=await issuer.read(scope,first._id);
  assert.equal(original.record.snapshot.total,'0.00');
  assert.deepEqual(original.record.snapshot.lines[0].rounding,snapshot.lines[0].rounding);
  await client.close(); client=new MongoClient(repl.getUri()); await client.connect(); db=client.db(dbName); issuer=await createIssuer({client,db});
  assert.deepEqual(await issuer.issue(scope,snapshot),first); assert.deepEqual((await issuer.read(scope,first._id)).pdf,original.pdf);
  const bad=structuredClone(snapshot);bad.lines[0].amount='0.01'; const {contentHash:_,...body}=bad;bad.contentHash=contentHash(body);
  await assert.rejects(issuer.issue(scope,bad),/LINE_AMOUNT_MISMATCH/);
  assert.equal(await db.collection('documentIssues').countDocuments(),1);assert.equal(await db.collection('documentArtifacts').countDocuments(),1);
  await db.collection('documentIssues').updateOne({_id:first._id},{$set:{'snapshot.lines.0.rounding.afterAmount':'0.02'}});
  await assert.rejects(issuer.read(scope,first._id),/SNAPSHOT_INTEGRITY/);
  await fs.writeFile(path.join(evidence,'mongo.json'),JSON.stringify({run,dbName,concurrentRequests:8,issues:1,artifacts:1,reconnectReplay:true,provenanceTamperingRejected:true}));
 } finally {
  assert.deepEqual(await db.collection('ownership').findOne({_id:'owner'}),owner);await db.dropDatabase();await client.close();await repl.stop();await fs.rm(root,{recursive:true,force:true});
 }
});
