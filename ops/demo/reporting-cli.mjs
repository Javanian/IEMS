import { readFile, realpath, lstat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createTenantFoundation } from '../../packages/tenant-foundation/index.mjs';
import { roleActions } from '../../apps/portfolio-api/src/commercial.mjs';
import { fulfillmentRoles, fulfillmentActions } from '../../apps/portfolio-api/src/fulfillment.mjs';
import { repairRoles } from '../../apps/portfolio-api/src/repair.mjs';
import { uuid } from '../../packages/domain-events/source-bindings.mjs';
import { createReportingRuntime } from './reporting-runtime.mjs';

export async function validatePrivateConfig(config) {
  if (!config || Object.keys(config).some(k => !['uri', 'databaseName', 'root', 'marker', 'token', 'python'].includes(k)) || !/^portfolio_test_[a-f0-9]{32}$/.test(config.databaseName) || !uuid.test(config.marker) || !/^[A-Za-z0-9_-]{43}$/.test(config.token)) throw new Error('EXPLICIT_PRIVATE_SYNTHETIC_CONFIG_REQUIRED');
  const uri = new URL(config.uri);
  if (uri.protocol !== 'mongodb:' || !['127.0.0.1', '[::1]'].includes(uri.hostname) || uri.username || uri.password || !uri.port || !['', '/'].includes(uri.pathname) || uri.hash || [...uri.searchParams.keys()].some(k => !['replicaSet', 'directConnection'].includes(k))) throw new Error('SYNTHETIC_LOOPBACK_SOURCE_ONLY');
  if (typeof config.root !== 'string' || !isAbsolute(config.root) || (await lstat(config.root)).isSymbolicLink()) throw new Error('EXPLICIT_EXTRACTION_ROOT_REQUIRED');
  const root = await realpath(config.root), marker = JSON.parse(await readFile(join(root, 'reporting-owner.json'), 'utf8'));
  if (marker.schema !== 'IEMS_REPORTING_SYNTHETIC_V1' || marker.marker !== config.marker || marker.databaseName !== config.databaseName) throw new Error('EXTRACTION_OWNERSHIP_MISMATCH');
  if (config.python && (!isAbsolute(config.python) || !(await lstat(config.python)).isFile())) throw new Error('EXPLICIT_PYTHON_EXECUTABLE_REQUIRED');
  return { ...config, root };
}

function parquetSink(config) {
  let child, closed = false;
  return { kind: 'PARQUET',
    async commit(event) {
      if (closed || child) throw new Error('RAW_SINK_CLOSED_OR_BUSY');
      const script = fileURLToPath(new URL('./reporting-raw.py', import.meta.url));
      await new Promise((resolve, reject) => {
        let failed = false;
        child = spawn(config.python, [script, config.root, config.marker, config.databaseName], { shell: false, windowsHide: true, timeout: 60000, stdio: ['pipe', 'ignore', 'ignore'] });
        child.once('error', () => { failed = true; });
        child.once('close', code => code === 0 && !failed ? resolve() : reject(new Error('RAW_PARQUET_COMMIT_FAILED')));
        child.stdin.on('error', () => { failed = true; child?.kill(); }); child.stdin.end(JSON.stringify(event));
      }).finally(() => { child = null; });
    },
    async close() { closed = true; if (child) throw new Error('RAW_COMMIT_STILL_RUNNING'); }
  };
}

export async function runReportingCli(input, { command = 'reconcile', runId } = {}) {
  // Validate URI, explicit DB name and filesystem ownership before opening any connection.
  const config = await validatePrivateConfig(input);
  if (!['reconcile', 'relay', 'extract'].includes(command) || command === 'extract' && !uuid.test(runId)) throw new Error('PRIVATE_COMMAND_REQUIRED');
  const require = createRequire(new URL('../../apps/portfolio-api/package.json', import.meta.url));
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 5000 });
  let runtime;
  try {
    await client.connect();
    const db = client.db(config.databaseName);
    const policy = Object.fromEntries(Object.entries({ ...roleActions, ...fulfillmentRoles, ...repairRoles }).map(([role, actions]) => [role, [...new Set([...actions, ...(role === 'owner' ? [...fulfillmentActions, 'repair.read'] : [])])].filter(a => ['quote.read', 'fulfillment.read', 'repair.read'].includes(a))]));
    const foundation = createTenantFoundation({ client, db, roleActions: policy });
    runtime = await createReportingRuntime({ db, client, foundation, root: config.root, marker: config.marker, rawSink: config.python ? parquetSink(config) : undefined,
      getScope: () => foundation.authenticate(config.token),
      authorizeResource: ({ collection, grant, resource, session }) => {
        if (!session?.inTransaction() || !['salesOrders', 'fulfillmentKeys', 'fulfillmentShipments', 'fulfillmentPayments', 'fulfillmentInvoices', 'fulfillmentDepositAllocations', 'fulfillmentCreditNotes', 'repairCases', 'repairReturnAuthorities', 'repairSalesOrders', 'repairWorkOrders', 'repairKeys', 'repairAudit', 'repairInvoices', 'deliveryHeads', 'deliveryConfirmations'].includes(collection) || resource.tenantId !== grant.tenantId || resource.plantId !== grant.plantId || [resource.legalEntityId, resource.ownerLegalEntityId].some(id => id && id !== grant.legalEntityId)) throw new Error('SOURCE_RESOURCE_DENIED');
      }
    });
    let result;
    if (command === 'relay') result = { sent: await runtime.relay(1000) };
    else {
      const id = command === 'extract' ? runId : (await runtime.reconcile()).manifest.runId;
      result = await runtime.extract(id);
    }
    return { ...result, status: runtime.status };
  } finally { try { await runtime?.close(); } finally { await client.close(); } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 16384) throw new Error('PRIVATE_INPUT_BOUND_EXCEEDED'); chunks.push(chunk); }
    console.log(JSON.stringify(await runReportingCli(JSON.parse(Buffer.concat(chunks).toString('utf8')), { command: process.argv[2], runId: process.argv[3] })));
  } catch { console.error('REPORTING_PRIVATE_RUN_FAILED; inspect private configuration/ownership/authorization and retained source evidence.'); process.exitCode = 1; }
}
