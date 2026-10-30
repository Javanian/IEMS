import { readFile } from 'node:fs/promises';
import { connectFoundationOwned } from '../../apps/portfolio-api/src/foundation-connection.mjs';
import { explainFoundation } from '../../apps/portfolio-api/src/foundation-explain.mjs';
if (!process.argv[2]) throw new Error('Usage: node ops/foundation/explain.mjs scope.json');
const scope = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { client, db } = await connectFoundationOwned();
try { console.log(JSON.stringify(await explainFoundation(db, scope), null, 2)); }
finally { await client.close(); }
