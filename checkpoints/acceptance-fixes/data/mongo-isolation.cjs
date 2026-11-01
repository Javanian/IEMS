const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { MongoMemoryReplSet: Original } = require(path.join(process.env.QA_SOURCE_ROOT, 'apps/portfolio-api/node_modules/mongodb-memory-server'));
const record = entry => fs.appendFileSync(path.join(process.env.QA_RUNTIME_ROOT, 'resource-events.ndjson'), JSON.stringify({ utc: new Date().toISOString(), ownerPid: process.pid, ...entry }) + '\n');
const blocked = path.join(process.env.QA_RUNTIME_ROOT, 'runtime-start-blocked.json');
async function preflight(port) {
  assert.ok(port >= 32100 && port <= 32199);
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  record({ kind: 'listener-preflight', port });
  return port;
}
class LaneReplSet extends Original {
  getInstanceOpts(options, keyfile) { return { ...super.getInstanceOpts(options, keyfile), portGeneration: false }; }
  static async create(options) {
    if (fs.existsSync(blocked)) throw Error('Runtime startup circuit is blocked; inspect the recorded failure before any new launch');
    const disk = fs.statfsSync(process.env.QA_RUNTIME_ROOT);
    if (disk.bavail * disk.bsize < 1024 ** 3) {
      fs.writeFileSync(blocked, JSON.stringify({ utc: new Date().toISOString(), reason: 'Less than1GiB free on the explicitly owned runtime volume', root: process.env.QA_RUNTIME_ROOT }));
      throw Error('Insufficient free runtime volume space; no Mongo launch attempted');
    }
    await preflight(32100);
    assert.equal(options.replSet.count, 1);
    const dbPath = fs.mkdtempSync(path.join(process.env.QA_RUNTIME_ROOT, 'mongo-'));
    const original = options.instanceOpts || [{}];
    assert.equal(original.length, 1);
    record({ kind: 'mongo-prepared', port: 32100, dbPath, command: process.env.MONGOMS_SYSTEM_BINARY });
    const repl = new LaneReplSet({ ...options, binary: { ...options.binary, systemBinary: process.env.MONGOMS_SYSTEM_BINARY }, replSet: { ...options.replSet, ip: '127.0.0.1' }, instanceOpts: [{ ...original[0], port: 32100, dbPath }] });
    try { await repl.start(); }
    catch (error) { await repl.stop(); record({ kind: 'mongo-start-failed', message: error.message, dbPath }); fs.writeFileSync(blocked, JSON.stringify({ utc: new Date().toISOString(), dbPath, message: error.message })); throw error; }
    for (const server of repl.servers) {
      assert.equal(server.instanceInfo.port, 32100);
      record({ kind: 'mongo-running', port: 32100, dbPath, pid: server.instanceInfo.instance.mongodProcess?.pid, killerPid: server.instanceInfo.instance.killerProcess?.pid });
    }
    return repl;
  }
  async stop(options) { const result = await super.stop(options); record({ kind: 'mongo-stopped' }); return result; }
}
exports.MongoMemoryReplSet = LaneReplSet;
exports.preflight = preflight;

