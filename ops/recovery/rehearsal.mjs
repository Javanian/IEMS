import { performance } from 'node:perf_hooks';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { contentHash } from '../../packages/tenant-foundation/commands.mjs';
import { validateDataset, readDataset, reconcile } from '../pilot/rehearsal.mjs';

export function backup(dataset, now = new Date()) {
  validateDataset(dataset);
  return { schema: 'IEMS_SYNTHETIC_BACKUP_V1', createdAt: now.toISOString(), payload: dataset, payloadHash: contentHash(dataset) };
}
export function restore(envelope) {
  if (envelope?.schema !== 'IEMS_SYNTHETIC_BACKUP_V1' || contentHash(envelope.payload) !== envelope.payloadHash ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(envelope.createdAt) || !Number.isFinite(Date.parse(envelope.createdAt))) throw new Error('Backup integrity invalid');
  return structuredClone(validateDataset(envelope.payload));
}
export function rehearse(envelope, expected, { maxRestoreMs = 1000, maxAgeMs = 86400000, now = new Date() } = {}) {
  if (![maxRestoreMs,maxAgeMs].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Positive SLO bounds required');
  const start = performance.now(), restored = restore(envelope), elapsedMs = performance.now() - start;
  const parity = reconcile(expected, restored), backupAgeMs = now.getTime() - Date.parse(envelope.createdAt);
  const withinBudget = elapsedMs <= maxRestoreMs && backupAgeMs >= 0 && backupAgeMs <= maxAgeMs;
  return { schema: 'SYNTHETIC_RESTORE_REPORT_V1', evidenceClass: 'LOCAL_SYNTHETIC', state: parity.state === 'MATCH' && withinBudget ? 'PASS' : 'FAIL',
    elapsedMs, backupAgeMs, maxRestoreMs, maxAgeMs, parity, actualServiceRto: 'NOT_RUN', actualServiceRpo: 'NOT_RUN', legacyDrain: 'NOT_RUN' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, source, target, report] = process.argv.slice(2);
    if (mode === 'backup' && source && target && !report) {
      await writeFile(target, JSON.stringify(backup(await readDataset(source)), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    } else if (mode === 'rehearse' && source && target && report) {
      const bytes = await readFile(source); if (bytes.length > 2_100_000) throw new Error('Backup too large');
      const result = rehearse(JSON.parse(bytes), await readDataset(target));
      await writeFile(report, JSON.stringify(result,null,2) + '\n', { flag: 'wx', mode: 0o600 });
      if (result.state !== 'PASS') process.exitCode = 1;
    } else throw new Error('Usage: backup source.json new-backup.json | rehearse backup.json expected.json new-report.json');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
