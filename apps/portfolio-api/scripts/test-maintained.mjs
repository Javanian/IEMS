import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
// This preserved historical contract requires VAT PDFs to return 422. Wave4h
// replaces it with positive issuance, rejection and settlement assertions.
const historical = 'wave4g-tax.test.mjs';
const tests = readdirSync(new URL('../test/', import.meta.url))
  .filter(name => name.endsWith('.test.mjs') && name !== historical)
  .sort()
  .map(name => `test/${name}`);
if (!tests.length) throw new Error('No maintained API tests found');
console.log(`Running ${tests.length} maintained files. Historical ${historical} is available via npm run test:historical-wave4g; its obsolete PDF rejection assertion is expected to fail.`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
