import { MongoClient } from 'mongodb';
import { createBridge } from './bridge.mjs';
import { createTenantFoundation } from '../../../packages/tenant-foundation/index.mjs';
import { createCustomerService } from '@iems/customer-service';
import { createFoundationOperatorAdapter, operatorRoleActions } from './foundation-operator.mjs';

const env = process.env;
if (env.WA_LIVE_ENABLED && env.WA_LIVE_ENABLED !== 'false') throw new Error('LIVE_POLICY_NOT_INTEGRATED');
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\//.test(env.WA_MONGO_URI ?? '') || !/^iems_wa_bridge_owned_[a-z0-9_]+$/.test(env.WA_DB_NAME ?? '')) throw new Error('Explicit local owned bridge database required');
const client = await new MongoClient(env.WA_MONGO_URI, { serverSelectionTimeoutMS: 3000 }).connect();
try {
  const db = client.db(env.WA_DB_NAME);
  if (!await db.collection('ownership').findOne({ _id: 'wa-bridge', synthetic: true })) throw new Error('Owned synthetic database marker missing');
  const adapterName = env.WA_OPERATOR_ADAPTER ?? 'none';
  if (!['none', 'foundation'].includes(adapterName)) throw new Error('Unknown operator adapter');
  const csMode = env.WA_CUSTOMER_SERVICE ?? 'disabled';
  if (!['disabled', 'enabled'].includes(csMode) || (csMode === 'enabled' && adapterName !== 'foundation')) throw new Error('Customer service requires the foundation adapter');
  let scopeAdapter, customerService;
  if (adapterName === 'foundation') {
    if (!/^iems_wa_bridge_owned_[a-z0-9_]+$/.test(env.WA_FOUNDATION_DB_NAME ?? '') || env.WA_FOUNDATION_DB_NAME === env.WA_DB_NAME) throw new Error('Separate owned foundation database required');
    const foundationDb = client.db(env.WA_FOUNDATION_DB_NAME);
    if (!await foundationDb.collection('ownership').findOne({ _id: 'wa-bridge-foundation', synthetic: true })) throw new Error('Owned foundation marker missing');
    const foundation = createTenantFoundation({ client, db: foundationDb, roleActions: operatorRoleActions });
    scopeAdapter = createFoundationOperatorAdapter({ foundation, db: foundationDb, tenantId: env.WA_TENANT, plantId: env.WA_PLANT_ID, account: env.WA_ACCOUNT });
    if (csMode === 'enabled') {
      // One attempt: a local preview is final and must not be re-claimed as a retry.
      customerService = createCustomerService({ client, db: foundationDb, foundation, maxSendAttempts: 1, previewDispatcher: true });
      await customerService.initialize();
    }
  }
  const bridge = await createBridge({ db, tenant: env.WA_TENANT, account: env.WA_ACCOUNT, serviceSecret: env.WA_SERVICE_SECRET, approvalKey: env.WA_APPROVAL_KEY, participants: (env.WA_PARTICIPANTS ?? '').split(',').filter(Boolean), receiveEnabled: env.WA_RECEIVE_PREVIEW === 'true', scopeAdapter, customerService });
  const port = Number(env.WA_PORT ?? 3047);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  await new Promise((resolve, reject) => { bridge.server.once('error', reject); bridge.server.listen(port, '127.0.0.1', resolve); });
  console.log(JSON.stringify({ mode: 'PREVIEW_ONLY', host: '127.0.0.1', port: bridge.server.address().port, liveEnabled: false, operatorAdapter: adapterName, customerService: csMode }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await new Promise(r => bridge.server.close(r)); await client.close(); });
} catch (e) { await client.close(); throw new Error(e.message === 'LIVE_POLICY_NOT_INTEGRATED' ? e.message : 'Preview startup refused; check owned database/configuration'); }
