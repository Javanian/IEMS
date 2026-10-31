import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { contentHash } from '../../packages/tenant-foundation/commands.mjs';

export const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const check = (ok, message) => { if (!ok) throw new Error(message); };
export function validateDataset(data) {
  check(data?.schema === 'IEMS_SYNTHETIC_PILOT_V1' && data.synthetic === true, 'Only explicitly synthetic pilot datasets are supported');
  check([data.tenantId, data.legalEntityId, data.plantId].every(uuid), 'UUID scope required');
  check(Array.isArray(data.records) && data.records.length <= 1000, 'Bounded records required');
  const ids = new Set();
  for (const row of data.records) {
    check(row && uuid(row.id) && !ids.has(row.id), 'Unique stable record UUID required'); ids.add(row.id);
    check(row.tenantId === data.tenantId && row.legalEntityId === data.legalEntityId && row.plantId === data.plantId, 'Cross-scope record rejected');
    check(typeof row.quantity === 'string' && /^(0|[1-9]\d{0,17})(\.\d{1,6})?$/.test(row.quantity), 'Nonnegative exact decimal quantity required');
    check(typeof row.uom === 'string' && /^[A-Z][A-Z0-9_]{0,15}$/.test(row.uom), 'Explicit UOM required');
    check(typeof row.resourceType === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(row.resourceType), 'Resource type required');
    check(Object.keys(row).every(k => ['id','tenantId','legalEntityId','plantId','resourceType','quantity','uom'].includes(k)), 'Unsupported record field');
  }
  check(Object.keys(data).every(k => ['schema','synthetic','tenantId','legalEntityId','plantId','records'].includes(k)), 'Unsupported dataset field');
  return data;
}
export function reconcile(source, target) {
  validateDataset(source); validateDataset(target);
  check(['tenantId','legalEntityId','plantId'].every(k => source[k] === target[k]), 'Scope mismatch');
  const normalize = x => ({ ...x, records: [...x.records].sort((a,b) => a.id.localeCompare(b.id)) });
  const sourceHash = contentHash(normalize(source)), targetHash = contentHash(normalize(target));
  return { schema: 'PILOT_RECONCILIATION_V1', evidenceClass: 'LOCAL_SYNTHETIC', sourceHash, targetHash,
    sourceCount: source.records.length, targetCount: target.records.length, state: sourceHash === targetHash ? 'MATCH' : 'MISMATCH',
    dataOwnerSignoff: 'NOT_RECORDED', permissionAcceptance: 'NOT_RUN', operatorTraining: 'NOT_RECORDED', realMigration: 'NOT_RUN' };
}
export async function readDataset(file) {
  const bytes = await readFile(file); check(bytes.length <= 2_000_000, 'Dataset too large');
  return validateDataset(JSON.parse(bytes.toString('utf8')));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [source, target, output] = process.argv.slice(2); check(source && target && output, 'Usage: node ops/pilot/rehearsal.mjs source.json target.json new-report.json');
    const result = reconcile(await readDataset(source), await readDataset(target));
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (result.state !== 'MATCH') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
