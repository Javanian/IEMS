import { MongoClient } from 'mongodb';
import { createCustomerService, SIMULATED_CHANNEL_ACCOUNT } from '../../../../packages/customer-service/index.mjs';
import { createTenantFoundation } from '../../../../packages/tenant-foundation/index.mjs';
import { createCustomerServicePort } from '../../src/customer-service-port.mjs';

const config = JSON.parse(process.env.OWNED_CRASH_CONFIG);
if (!/^iems_wa_bridge_owned_kill_[a-f0-9]+$/.test(config.name)) throw new Error('OWNED_DATABASE_REQUIRED');
const client = await new MongoClient(config.uri).connect();
const db = client.db(config.name);
if (!await db.collection('ownedRun').findOne({ _id: config.marker })) throw new Error('OWNED_MARKER_REQUIRED');
const pause = async boundary => {
  if (boundary !== config.boundary) return;
  process.send({ barrier: boundary, pid: process.pid });
  await new Promise(() => {});
};
const foundation = createTenantFoundation({ client, db, roleActions: { admin: ['cs.fixture.admin', 'cs.delivery.review'] } });
const cs = createCustomerService({ client, db, foundation, previewDispatcher: true, allowSyntheticOrders: true, now: () => new Date(Date.now() + (config.offset ?? 0)), faultInjector: pause });
const dispatchCs = { ...cs, async recordDeliveryResult(input) { await pause('previewInserted'); return cs.recordDeliveryResult(input); } };
const port = await createCustomerServicePort({ customerService: dispatchCs, db, scope: { tenant: config.tenantId, account: SIMULATED_CHANNEL_ACCOUNT }, active: async () => true, isPaused: async () => false, now: () => Date.now(), transaction: async fn => { const session = client.startSession(); try { return await session.withTransaction(() => fn(session)); } finally { await session.endSession(); } } });
try {
  const result = config.dispatch ? await port.dispatch() : await port.handle(config.contact, config.eventId, config.text);
  process.send({ result, pid: process.pid });
} finally { await client.close(); process.disconnect(); }
