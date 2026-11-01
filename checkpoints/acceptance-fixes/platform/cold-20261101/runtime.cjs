const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = process.env.QA_RUNTIME_ROOT;
assert.ok(path.isAbsolute(root) && fs.realpathSync(root).startsWith('D:\\Project AI\\GITHUB\\IEMS-evidence\\agent-checkpoints\\902f6e0b-5445-4abc-a532-2b467b6fe973\\'));
const record = entry => fs.appendFileSync(path.join(root, 'events.ndjson'), JSON.stringify({ utc: new Date().toISOString(), ownerPid: process.pid, ...entry }) + '\n');
const cpu = () => os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
const busy = (a, b) => { const total = b.reduce((n, c, i) => n + c.total - a[i].total, 0), idle = b.reduce((n, c, i) => n + c.idle - a[i].idle, 0); return total ? 100 * (1 - idle / total) : 0; };
const identities = ids => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ids=@(${ids.join(',')}); @(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -in $ids} | Select-Object ProcessId,ParentProcessId,CreationDate,Name,CommandLine,WorkingSetSize) | ConvertTo-Json -Depth 4 -Compress`], { encoding: 'utf8', timeout: 10000, windowsHide: true }) || '[]');
async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function preflight() {
  const start = cpu(); await new Promise(r => setTimeout(r, 1000));
  const disk = fs.statfsSync(root);
  const observation = { kind: 'resource-preflight', freeRamBytes: os.freemem(), hostCpuPercent: busy(start, cpu()), freeDiskBytes: disk.bavail * disk.bsize, minimumRamBytes: 2 * 1024 ** 3, maximumCpuPercent: 80, minimumDiskBytes: 1024 ** 3 };
  record(observation);
  assert.ok(observation.freeRamBytes >= observation.minimumRamBytes && observation.hostCpuPercent < observation.maximumCpuPercent && observation.freeDiskBytes >= observation.minimumDiskBytes, 'Original CPU/RAM/disk preflight failed; no native launch');
  const others = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-CimInstance Win32_Process | Where-Object {$_.Name -like 'mongod*' -or $_.Name -in @('java.exe','docker.exe','rg.exe')} | Select-Object ProcessId,Name,CreationDate) | ConvertTo-Json -Compress"], { encoding: 'utf8', timeout: 10000, windowsHide: true }) || '[]');
  record({ kind: 'exclusive-window-preflight', conflictingProcesses: others });
  assert.equal(others.length, 0, 'Native runtime or source probe is active; no owned start');
  for (const port of [32720, 32721, 32722]) await freePort(port);
}
const { MongoMemoryReplSet: Original } = require(path.join(process.env.QA_SOURCE_ROOT, 'apps/portfolio-api/node_modules/mongodb-memory-server'));
class ProfiledReplSet extends Original {
  getInstanceOpts(options, keyfile) { return { ...super.getInstanceOpts(options, keyfile), portGeneration: false }; }
  static async create(options) {
    await preflight();
    assert.equal(options.replSet.count, 1); assert.equal(options.instanceOpts.length, 1);
    const dbPath = fs.mkdtempSync(path.join(root, 'mongo-'));
    const repl = new ProfiledReplSet({ ...options, replSet: { ...options.replSet, ip: '127.0.0.1' }, instanceOpts: [{ ...options.instanceOpts[0], dbPath, port: 32720 }] });
    record({ kind: 'mongo-prepared', dbPath, port: 32720, binary: options.binary.systemBinary });
    try { await repl.start(); } catch (error) { await repl.stop(); record({ kind: 'mongo-start-failed', message: error.message }); throw error; }
    for (const server of repl.servers) {
      const info = server.instanceInfo, pid = info.instance.mongodProcess.pid, killerPid = info.instance.killerProcess.pid;
      record({ kind: 'mongo-running', pid, killerPid, port: info.port, dbPath, identities: identities([process.pid, pid, killerPid]) });
    }
    return repl;
  }
  async stop(options) { const value = await super.stop(options); record({ kind: 'mongo-stopped' }); return value; }
}
function observeClient(client) {
  const pending = new Map(), totals = {};
  client.on('commandStarted', e => pending.set(e.requestId, { name: e.commandName, collection: e.command.createIndexes }));
  const finished = (event, failed) => {
    const info = pending.get(event.requestId); pending.delete(event.requestId); if (!info) return;
    const row = totals[info.name] ??= { count: 0, durationMs: 0, failures: 0 };
    row.count++; row.durationMs += event.duration; row.failures += Number(failed);
    if (info.name === 'createIndexes') record({ kind: 'index-command', collection: info.collection, durationMs: event.duration, failed });
  };
  client.on('commandSucceeded', e => finished(e, false)); client.on('commandFailed', e => finished(e, true));
  client.on('topologyClosed', () => record({ kind: 'command-totals', totals }));
}
module.exports = { MongoMemoryReplSet: ProfiledReplSet, record, observeClient, identities, freePort, cpu, busy };
