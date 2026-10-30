import { readFile } from 'node:fs/promises';
import { planMigration, initializeMigration, stageMigration, verifyMigration, rollbackMigration } from '../../database/migrations/platform-foundation/v1.mjs';

const [mode, path] = process.argv.slice(2);
if (!['plan', 'stage', 'verify', 'rollback'].includes(mode) || !path) throw new Error('Usage: node ops/foundation/migrate.mjs plan|stage|verify|rollback manifest.json');
const input = JSON.parse(await readFile(path, 'utf8'));
if (mode === 'plan') {
  const { rows, ...plan } = planMigration(input);
  console.log(JSON.stringify({ ...plan, expected: { hash: plan.hash, counts: plan.counts, ledgerTotals: plan.ledgerTotals } }, null, 2));
} else {
  if (process.env.FOUNDATION_RUN_ID !== input.runId) throw new Error('FOUNDATION_RUN_ID must match the manifest run ID');
  const { connectFoundationOwned } = await import('../../apps/portfolio-api/src/foundation-connection.mjs');
  const { client, db } = await connectFoundationOwned();
  try {
    if (mode === 'stage') await initializeMigration(db);
    const result = mode === 'stage' ? await stageMigration(client, db, input)
      : mode === 'verify' ? await verifyMigration(db, input) : await rollbackMigration(client, db, input);
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.close(); }
}
