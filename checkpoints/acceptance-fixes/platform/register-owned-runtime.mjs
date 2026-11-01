import { registerHooks } from 'node:module';
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from 'node:http';
import assert from 'node:assert/strict';
const helper = pathToFileURL(resolve('apps/portfolio-api/test/support/owned-mongo.mjs')).href;
const record = entry => appendFileSync(join(process.env.QA_RUNTIME_ROOT, 'resource-events.ndjson'), JSON.stringify({ utc: new Date().toISOString(), ownerPid: process.pid, ...entry }) + '\n');
const prefix = `portfolio_owned_iems_qa_security_${process.env.PAPERCLIP_RUN_ID.slice(0, 8)}_`;
assert.match(prefix, /^portfolio_owned_iems_qa_security_[a-f0-9]{8}_$/);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'mongodb-memory-server' && context.parentURL === helper) return { url: new URL('./mongo-isolation.cjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== helper) return next(url, context);
    const before = readFileSync(new URL(url), 'utf8');
    let after = before.replace("client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`)", 'client.db(`' + prefix + "${randomUUID().replaceAll('-', '').slice(0, 16)}`)");
    after = after.replace('http://localhost:4173', 'http://127.0.0.1:32302');
    after = "import { appendFileSync as recordFile } from 'node:fs';\nimport { join as evidencePath } from 'node:path';\n" + after;
    after = after.replace('  const repl = await', `  const started = performance.now();
  const timing = stage => recordFile(evidencePath(process.env.QA_RUNTIME_ROOT, 'resource-events.ndjson'), JSON.stringify({ utc: new Date().toISOString(), ownerPid: process.pid, kind: 'setup-timing', stage, elapsedMs: performance.now() - started }) + '\\n');
  timing('begin');
  const repl = await`);
    after = after.replace('  const client = await', "  timing('replica-ready');\n  const client = await");
    after = after.replace('  server = createApp', "  timing('initialized-and-seeded');\n  server = createApp");
    after = after.replace('  const ok = async', "  timing('authenticated');\n  const ok = async");
    after = after.replace('  const base = () =>', `  recordFile(evidencePath(process.env.QA_RUNTIME_ROOT, 'resource-events.ndjson'), JSON.stringify({ utc: new Date().toISOString(), ownerPid: process.pid, kind: 'database-owned', databaseName: db.databaseName, marker }) + '\\n');
  t.after(() => recordFile(evidencePath(process.env.QA_RUNTIME_ROOT, 'resource-events.ndjson'), JSON.stringify({ utc: new Date().toISOString(), ownerPid: process.pid, kind: 'fixture-cleanup-completed', databaseName: db.databaseName, marker }) + '\\n'));
  const base = () =>`);
    assert.deepEqual(after.split('\n').filter(x => /\bassert[.(]/.test(x)), before.split('\n').filter(x => /\bassert[.(]/.test(x)));
    return { format: 'module', source: after, shortCircuit: true };
  }
});
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  assert.equal(args[0], 0);
  assert.equal(args[1], '127.0.0.1');
  args[0] = 32301;
  this.once('listening', () => record({ kind: 'api-running', address: this.address() }));
  this.once('close', () => record({ kind: 'api-stopped', port: 32301 }));
  return listen.apply(this, args);
};
