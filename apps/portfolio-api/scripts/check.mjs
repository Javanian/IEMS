import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
for (const dir of ['src', 'test', 'scripts']) for (const file of readdirSync(dir).filter(v => v.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', resolve(dir, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Syntax checks passed');
