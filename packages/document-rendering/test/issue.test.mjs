import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import * as api from '../src/index.mjs';
const scope = { tenantId:'tenant-a',legalEntityId:'entity-a',plantId:'plant-a' };
function raw() { return { _id:'invoice-a',...scope,version:1,currency:'KWD',taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',total:'9007199254740993.123',lines:[{description:'Exact high scale item',quantity:'1',unitPrice:'9007199254740993.123',currency:'KWD',uom:'KG'}] }; }
test('real owned Mongo transaction issues once across concurrent retries reconnect and rejects conflicts and cross scope', async () => {
  assert.equal(typeof api.createIssuer,'function');
  const run = randomUUID().replaceAll('-',''), dbName = 'owned_document_'+run;
  const root = path.resolve('.runtime',run); await fs.mkdir(root,{recursive:true});
  const binary = process.env.MONGOMS_SYSTEM_BINARY;
  const repl = await MongoMemoryReplSet.create({ binary:{systemBinary:binary,version:'7.0.14'},instanceOpts:[{dbPath:root}],replSet:{count:1,storageEngine:'wiredTiger',ip:'127.0.0.1'} });
  let client = new MongoClient(repl.getUri()); await client.connect(); const db = client.db(dbName);
  const owner = { _id:'owner',run,dbName }; await db.collection('ownership').insertOne(owner);
  try {
    assert.deepEqual(await db.collection('ownership').findOne({_id:'owner'}),owner);
    const snapshot = api.createSnapshot('invoice',scope,raw());
    let issuer = await api.createIssuer({client,db});
    const results = await Promise.all(Array.from({length:12},()=>issuer.issue(scope,snapshot)));
    assert.equal(new Set(results.map(x=>x._id)).size,1);
    assert.equal(await db.collection('documentIssues').countDocuments(),1); assert.equal(await db.collection('documentArtifacts').countDocuments(),1);
    const first = results[0]; const bytes = (await issuer.read(scope,first._id)).pdf;
    await client.close(); client = new MongoClient(repl.getUri()); await client.connect();
    issuer = await api.createIssuer({client,db:client.db(dbName)});
    assert.deepEqual(await issuer.issue(scope,snapshot),first);
    assert.deepEqual((await issuer.read(scope,first._id)).pdf,bytes);
    assert.equal(await issuer.read({...scope,plantId:'other'},first._id),null);
    await assert.rejects(issuer.issue({...scope,tenantId:'other'},snapshot),/SCOPE_MISMATCH/);
    const changed=raw(); changed.lines[0].description='Different';
    await assert.rejects(issuer.issue(scope,api.createSnapshot('invoice',scope,changed)),/ISSUE_CONFLICT/);
    await client.db(dbName).command({collMod:'documentIssues',validator:{blocked:{$exists:true}},validationLevel:'strict'});
    const next=raw();next.version=2;
    await assert.rejects(issuer.issue(scope,api.createSnapshot('invoice',scope,next)),/validation/i);
    assert.equal(await client.db(dbName).collection('documentIssues').countDocuments(),1);
    assert.equal(await client.db(dbName).collection('documentArtifacts').countDocuments(),1,'artifact rolled back with rejected issue record');
    await client.db(dbName).command({collMod:'documentIssues',validator:{}});
    await client.db(dbName).collection('documentArtifacts').updateOne({_id:first._id},{$set:{pdf:Buffer.from('corrupt')}});
    await assert.rejects(issuer.read(scope,first._id),/ARTIFACT_INTEGRITY/);
    await fs.mkdir('evidence/wave3/c-20261022-01',{recursive:true});
    await fs.writeFile('evidence/wave3/c-20261022-01/owned-mongo.json',JSON.stringify({run,dbName,uri:repl.getUri(),binary,parallelRequests:12,issues:1,artifacts:1,reconnectReplay:true,cleanup:'marker-verified database dropped; replica stopped in finally'},null,2));
  } finally {
    const cleanup = client.db(dbName); assert.deepEqual(await cleanup.collection('ownership').findOne({_id:'owner'}),owner);
    await cleanup.dropDatabase(); await client.close(); await repl.stop(); await fs.rm(root,{recursive:true,force:true});
  }
});
