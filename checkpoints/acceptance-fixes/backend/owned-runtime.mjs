import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'node:http';
import { MongoMemoryReplSet } from '../../../apps/portfolio-api/node_modules/mongodb-memory-server/index.js';
import { Db } from '../../../apps/portfolio-api/node_modules/mongodb/lib/index.js';

const base = '010ec3b4e826d05b7e1f191286da042fe5a2bd42';
const root = new URL('../../../', import.meta.url);
const support = new URL('apps/portfolio-api/test/support/owned-mongo.mjs', root).href;
const labor = new URL('apps/portfolio-api/test/wave4c-labor.test.mjs', root).href;
const amended = process.env.TPR165_AMENDED_LABOR === '1';
if (amended) assert.match(process.env.PAPERCLIP_RUN_ID, /^[a-f0-9-]{36}$/);
registerHooks({ load(url, context, next) {
  if (url === labor && process.env.TPR165_ORIGINAL_LABOR === '1') {
    return { format: 'module', source: execFileSync('git', ['show', `${base}:apps/portfolio-api/test/wave4c-labor.test.mjs`], { cwd: fileURLToPath(root), encoding: 'utf8' }), shortCircuit: true };
  }
  if (url === support && amended) {
    const source = readFileSync(new URL(url), 'utf8');
    const from = "client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`)";
    assert.equal(source.split(from).length, 2);
    const to = "client.db(`portfolio_owned_iems_qa_business_" + process.env.PAPERCLIP_RUN_ID.slice(0, 8) + "_${randomUUID().replaceAll('-', '').slice(0, 16)}`)";
    return { format: 'module', source: source.replace(from, to), shortCircuit: true };
  }
  return next(url, context);
} });

const create = MongoMemoryReplSet.create;
MongoMemoryReplSet.create = async function (...args) {
  const repl = await create.apply(this, args);
  const resources = repl.servers.map(server => {
    const info = server.instanceInfo;
    return { pid: info.instance.mongodProcess.pid, port: info.port, dbPath: info.dbPath };
  });
  console.log(JSON.stringify({ resourceStart: resources, owner: 'TPR-165', at: new Date().toISOString() }));
  const stop = repl.stop.bind(repl);
  repl.stop = async (...options) => {
    const result = await stop(...options);
    for (const resource of resources) {
      let alive = true;
      try { process.kill(resource.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; else throw e; }
      console.log(JSON.stringify({ resourceStop: resource, alive, at: new Date().toISOString() }));
      assert.equal(alive, false);
    }
    return result;
  };
  return repl;
};
const drop = Db.prototype.dropDatabase;
Db.prototype.dropDatabase = async function (...args) {
  const marker = await this.collection('ownedRun').findOne();
  assert.ok(marker);
  const result = await drop.apply(this, args);
  console.log(JSON.stringify({ databaseDropped: this.databaseName, marker: marker._id, result }));
  return result;
};
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address();
    console.log(JSON.stringify({ httpStart: address, pid: process.pid }));
    this.once('close', () => console.log(JSON.stringify({ httpStop: address, pid: process.pid })));
  });
  return listen.apply(this, args);
};
