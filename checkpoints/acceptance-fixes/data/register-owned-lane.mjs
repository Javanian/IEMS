import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const helper = pathToFileURL(resolve(process.env.QA_SOURCE_ROOT, 'apps/portfolio-api/test/support/owned-mongo.mjs')).href;
const before = readFileSync(new URL(helper), 'utf8');
const prefix = `portfolio_owned_iems_qa_business_${process.env.PAPERCLIP_RUN_ID.slice(0, 8)}_`;
assert.match(prefix, /^portfolio_owned_iems_qa_business_[a-f0-9]{8}_$/);
let after = before.replace("client.db(`portfolio_test_${randomUUID().replaceAll('-', '')}`)", 'client.db(`' + prefix + "${randomUUID().replaceAll('-', '').slice(0, 16)}`)");
after = "import { appendFileSync as recordFile } from 'node:fs';\nimport { join as evidencePath } from 'node:path';\n" + after;
after = after.replace('  const base = () =>', `  const record = entry => recordFile(evidencePath(process.env.QA_RUNTIME_ROOT, 'resource-events.ndjson'), JSON.stringify({ utc: new Date().toISOString(), ownerPid: process.pid, ...entry }) + '\\n');
  record({ kind: 'api-and-database-owned', port: server.address().port, databaseName: db.databaseName, marker });
  t.after(() => record({ kind: 'fixture-cleanup-completed', databaseName: db.databaseName, marker }));
  const base = () =>`);
assert.notEqual(after, before);
assert.deepEqual(after.split('\n').filter(x => /\bassert[.(]/.test(x)), before.split('\n').filter(x => /\bassert[.(]/.test(x)));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'mongodb-memory-server' && context.parentURL === helper) return { url: new URL('./mongo-isolation.cjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === helper) return { format: 'module', source: after, shortCircuit: true };
    return next(url, context);
  }
});
