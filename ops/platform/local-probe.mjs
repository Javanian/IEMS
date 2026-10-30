import { MongoClient } from 'mongodb';
import { initialize, seedSynthetic } from '../../apps/portfolio-api/src/app.mjs';
import { roleActions } from '../../apps/portfolio-api/src/commercial.mjs';
import { platformActions, platformRoles } from '../../apps/portfolio-api/src/platform-runtime.mjs';
const owner = process.env.PLATFORM_OWNER, database = process.env.PLATFORM_DB;
if (!/^iems-tpr139-[a-f0-9]{12}$/.test(owner) || database !== `portfolio_owned_${owner.replaceAll('-', '_')}`) throw new Error('Owned database required');
const client = new MongoClient(process.env.PLATFORM_MONGO_URI, { serverSelectionTimeoutMS: 3000, maxPoolSize: 2, socketTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(database);
  if (!(await db.collection('platformOwnership').findOne({ _id: owner, sourceSha: process.env.PLATFORM_SOURCE_SHA }))) throw new Error('Ownership marker mismatch');
  const [command, jobId] = process.argv.slice(2);
  if (command === 'seed') {
    if (!(await db.collection('credentials').countDocuments())) {
      let password = '';
      for await (const chunk of process.stdin) { password += chunk; if (password.length > 256) throw new Error('Invalid probe password'); }
      Object.assign(roleActions, platformRoles); roleActions.owner.push(...platformActions);
      const runtime = await initialize({ client, db });
      await seedSynthetic(runtime, { password: password.trim() });
    }
    console.log(JSON.stringify({ seeded: true }));
  } else if (command === 'verify' && /^[a-f0-9-]{36}$/.test(jobId)) {
    const job = await db.collection('jobs').findOne({ _id: jobId, kind: 'platform.persistence-probe', status: 'SUCCEEDED' });
    const count = await db.collection('platformLocalProbes').countDocuments({ _id: jobId });
    if (!job || count !== 1) throw new Error('Persistence invariant failed');
    console.log(JSON.stringify({ jobId, status: job.status, persistedRecords: count, revision: job.revision }));
  } else throw new Error('Invalid probe command');
} finally { await client.close(); }
