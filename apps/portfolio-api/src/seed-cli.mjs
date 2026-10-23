import { seedSynthetic } from './app.mjs';
import { connectOwned } from './config.mjs';
if (process.argv[2] !== '--synthetic-owned') throw new Error('Explicit --synthetic-owned required');
const password = process.env.PORTFOLIO_SEED_PASSWORD;
delete process.env.PORTFOLIO_SEED_PASSWORD;
const runtime = await connectOwned();
try {
  const identities = await seedSynthetic(runtime, { password });
  console.log(JSON.stringify({ seeded: true, identities }));
} finally { await runtime.client.close(); }
