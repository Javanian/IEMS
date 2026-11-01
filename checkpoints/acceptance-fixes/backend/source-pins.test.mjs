import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, symlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { admissionRegistry, verifyAdmissionSources } from '../../../packages/tenant-lifecycle/admission-registry.mjs';
import { businessRegistry, verifySourceSchemas } from '../../../packages/tenant-lifecycle/domain-port.mjs';

test('both actual verifiers reject an isolated operations mismatch and accept restoration', async () => {
  await verifyAdmissionSources(); await verifySourceSchemas();
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  assert.ok(process.env.PAPERCLIP_RUN_SCRATCH_DIR);
  const copy = await mkdtemp(join(process.env.PAPERCLIP_RUN_SCRATCH_DIR, 'tpr165-source-pins-'));
  const paths = new Set([...Object.keys(admissionRegistry.sources), ...Object.keys(businessRegistry.sources),
    'packages/tenant-lifecycle/admission-registry.mjs', 'packages/tenant-lifecycle/admission-registry.json',
    'packages/tenant-lifecycle/domain-port.mjs', 'packages/tenant-lifecycle/domain-registry.json',
    'packages/tenant-foundation/commands.mjs', 'apps/portfolio-api/package.json']);
  for (const path of paths) {
    await mkdir(dirname(resolve(copy, path)), { recursive: true });
    await copyFile(resolve(root, path), resolve(copy, path));
  }
  await symlink(resolve(root, 'apps/portfolio-api/node_modules'), resolve(copy, 'apps/portfolio-api/node_modules'), 'junction');
  const admission = await import(pathToFileURL(resolve(copy, 'packages/tenant-lifecycle/admission-registry.mjs')));
  const domain = await import(pathToFileURL(resolve(copy, 'packages/tenant-lifecycle/domain-port.mjs')));
  await admission.verifyAdmissionSources(); await domain.verifySourceSchemas();
  const source = resolve(copy, 'apps/portfolio-api/src/operations.mjs'), original = await readFile(source);
  await writeFile(source, Buffer.concat([original, Buffer.from('\n// isolated source mismatch\n')]));
  try {
    await assert.rejects(admission.verifyAdmissionSources(), { code: 'SAAS_HOST_SOURCE_CHANGED', status: 503 });
    await assert.rejects(domain.verifySourceSchemas(), { code: 'TENANT_SOURCE_SCHEMA_CHANGED', status: 503 });
  } finally { await writeFile(source, original); }
  await admission.verifyAdmissionSources(); await domain.verifySourceSchemas();
  assert.deepEqual(await readFile(source), original);
  console.log(JSON.stringify({ isolatedRegistryCopy: copy, operationsMismatchRejected: true, restored: true }));
});
