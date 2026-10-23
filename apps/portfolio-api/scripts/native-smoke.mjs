import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { connectOwned } from '../src/config.mjs';
import { createApp } from '../src/app.mjs';
const ops = fileURLToPath(new URL('../../../ops/job13/mongo.mjs', import.meta.url));
const owner = 'portfolio-wave1b-native', profile = 'portfolio-a';
const command = action => {
  const result = spawnSync(process.execPath, [ops, action, '--owner', owner, '--profile', profile, '--port', '27327'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
const started = command('start');
let runtime, server;
const marker = randomUUID();
const env = { ...process.env, PORTFOLIO_MONGO_URI: started.uri, PORTFOLIO_DB: `portfolio_owned_smoke_${marker.replaceAll('-', '')}`, PORTFOLIO_SEED_PASSWORD: randomUUID() };
try {
  runtime = await connectOwned(env);
  await runtime.db.collection('ownedRun').insertOne({ _id: marker });
  const childEnv = { ...env }; delete childEnv.NODE_TEST_CONTEXT;
  const seeded = spawnSync(process.execPath, [fileURLToPath(new URL('../src/seed-cli.mjs', import.meta.url)), '--synthetic-owned'], { env: childEnv, encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.equal(JSON.parse(seeded.stdout).identities.length, 2);
  server = createApp(runtime, { origins: ['http://localhost:4173'] }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/session/login', { method: 'POST', headers: { origin: 'http://localhost:4173', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alpha.owner', password: env.PORTFOLIO_SEED_PASSWORD }) });
  assert.equal(login.status, 200);
  const me = await fetch(base + '/api/session/me', { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } });
  assert.equal(me.status, 200);
  console.log(JSON.stringify({ nativeMongo: started.ready, replicaSet: started.replicaSet, seedCli: true, login: login.status, me: me.status, passwordsLogged: false }));
} finally {
  if (server) await new Promise(r => server.close(r));
  if (runtime) { assert.ok(await runtime.db.collection('ownedRun').findOne({ _id: marker })); await runtime.db.dropDatabase(); await runtime.client.close(); }
  console.log(JSON.stringify({ cleanup: command('stop') }));
}
