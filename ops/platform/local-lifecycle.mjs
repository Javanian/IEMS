import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [action, directory, portText = '14313'] = process.argv.slice(2);
if (!['up', 'health', 'verify', 'restart', 'down'].includes(action) || !directory || !isAbsolute(directory)) throw new Error('Usage: local-lifecycle.mjs up|health|verify|restart|down ABSOLUTE_PRIVATE_STATE_DIR [PORT]');
const stateDir = resolve(directory), within = relative(root, stateDir);
if (!within.startsWith('..') && !isAbsolute(within)) throw new Error('Keep private Terraform state outside the source checkout');
const apiPort = Number(portText);
if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) throw new Error('Invalid loopback port');
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const lock = join(stateDir, 'lifecycle.lock'), lockFd = openSync(lock, 'wx', 0o600);
const evidence = { action, startedAt: new Date().toISOString(), checks: [], status: 'RUNNING' };
const record = (tool, args, options = {}) => {
  const result = spawnSync(tool, args, { cwd: options.cwd || root, timeout: options.timeout || 120000, encoding: 'utf8', windowsHide: true, input: options.input, env: options.env || process.env });
  const redact = value => [state?.password, state?.probePassword].filter(Boolean).reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value || '');
  evidence.checks.push({ tool, args, exit: result.status, error: result.error?.code, stdout: redact(result.stdout), stderr: redact(result.stderr), at: new Date().toISOString() });
  if (result.error || result.status !== 0) throw Object.assign(new Error(`${tool} failed: ${result.error?.code || result.status}; see private evidence`), { result });
  return result.stdout.trim();
};
let state;
try {
  const metadata = join(stateDir, 'ownership.json');
  const sourceSha = record('git', ['rev-parse', 'HEAD']);
  const dockerHost = process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
  if (existsSync(metadata)) state = JSON.parse(readFileSync(metadata, 'utf8'));
  else {
    if (action !== 'up') throw new Error('No existing owned deployment');
    if (record('git', ['status', '--porcelain'])) throw new Error('Commit source changes before building a source-addressed local image');
    if (record('git', ['branch', '--show-current']) !== 'program/iems-all-20261030-platform') throw new Error('Assigned platform branch required');
    state = { owner: `iems-tpr139-${randomBytes(6).toString('hex')}`, workspace: resolve(root), stateDir, sourceSha, apiPort, dockerHost, password: randomBytes(32).toString('hex'), probePassword: randomBytes(24).toString('hex'), image: `iems-platform:${sourceSha.slice(0, 12)}`, phase: 'PREPARED' };
    writeFileSync(metadata, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
  }
  if (!/^iems-tpr139-[a-f0-9]{12}$/.test(state.owner) || state.workspace !== resolve(root) || state.stateDir !== stateDir || !/^[a-f0-9]{40}$/.test(state.sourceSha) || state.dockerHost !== dockerHost || !Number.isInteger(state.apiPort) || !/^[a-f0-9]{64}$/.test(state.password) || !/^[a-f0-9]{48}$/.test(state.probePassword)) throw new Error('Ownership/state mismatch');
  if (action === 'up' && state.sourceSha !== sourceSha) throw new Error('Source changed; use a new private state directory for the new candidate');
  evidence.owner = state.owner; evidence.sourceSha = state.sourceSha; evidence.stateDir = stateDir;
  const docker = args => record('docker', ['--host', dockerHost, ...args]);
  docker(['version', '--format', '{{json .Server.Version}}']);
  const serviceNames = ['mongo', 'rabbit', 'redis', 'api'].map(name => `${state.owner}-${name}`);
  const verifyOwnership = () => {
    for (const [kind, list] of [['container', ['ps', '-aq']], ['volume', ['volume', 'ls', '-q']], ['network', ['network', 'ls', '-q']]]) {
      const ids = docker([...list, '--filter', `label=iems.owner=${state.owner}`]).split(/\r?\n/).filter(Boolean);
      for (const id of ids) {
        const data = JSON.parse(docker([kind === 'container' ? 'inspect' : kind, ...(kind === 'container' ? [] : ['inspect']), id]))[0];
        const labels = kind === 'container' ? data.Config?.Labels : data.Labels;
        const expected = kind === 'container' ? serviceNames : kind === 'volume' ? [`${state.owner}-mongo`, `${state.owner}-rabbit`] : [state.owner];
        if (labels?.['iems.owner'] !== state.owner || labels?.['iems.issue'] !== 'TPR-139' || labels?.['iems.source'] !== state.sourceSha || !expected.includes(data.Name.replace(/^\//, ''))) throw new Error(`Unrecognized ${kind} ownership`);
      }
    }
  };
  const api = `http://127.0.0.1:${state.apiPort}`;
  const health = async () => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${api}/health`, { signal: AbortSignal.timeout(3000) });
        const body = await response.json();
        if (response.ok && body.owner === state.owner && body.sourceSha === state.sourceSha && body.status === 'ok') { evidence.checks.push({ health: 'PASS', at: new Date().toISOString() }); return body; }
      } catch { /* Bounded startup retry against this deployment's loopback endpoint. */ }
      await delay(1000);
    }
    throw new Error('Owned health deadline exceeded');
  };
  const helper = (command, id, input) => record('docker', ['--host', dockerHost, 'exec', '-i', `${state.owner}-api`, 'node', 'ops/platform/local-probe.mjs', command, ...(id ? [id] : [])], { input, timeout: 30000 });
  const tfDir = join(stateDir, 'terraform');
  const save = () => writeFileSync(metadata, JSON.stringify(state, null, 2), { mode: 0o600 });
  const tfEnv = { ...process.env, CHECKPOINT_DISABLE: '1', TF_IN_AUTOMATION: '1', TF_INPUT: '0' };
  for (const key of Object.keys(tfEnv)) if (key.startsWith('TF_CLI_ARGS') || key.startsWith('TF_VAR_')) delete tfEnv[key];
  tfEnv.TF_CLI_CONFIG_FILE = join(stateDir, 'offline-provider.tfrc');
  tfEnv.TF_DATA_DIR = join(stateDir, 'provider-data');
  tfEnv.TF_WORKSPACE = 'default';
  const terraform = args => record('terraform', args, { cwd: tfDir, env: tfEnv, timeout: 180000 });
  const verifyState = () => {
    const path = join(tfDir, 'terraform.tfstate');
    if (!existsSync(path)) return;
    const snapshot = JSON.parse(readFileSync(path, 'utf8'));
    for (const resource of snapshot.resources || []) {
      if (resource.mode !== 'managed' || !['docker_container', 'docker_network', 'docker_volume', 'docker_image'].includes(resource.type) || resource.module) throw new Error('Unexpected resource in owned Terraform state');
      for (const instance of resource.instances || []) {
        const attributes = instance.attributes;
        if (resource.type === 'docker_image') {
          if (!['mongo:7.0.14', 'rabbitmq:4.1.5-alpine', 'redis:7.4.6-alpine', state.image].includes(attributes.name) || attributes.keep_locally !== true) throw new Error('Unexpected image state');
          continue;
        }
        const names = resource.type === 'docker_container' ? serviceNames : resource.type === 'docker_volume' ? [`${state.owner}-mongo`, `${state.owner}-rabbit`] : [state.owner];
        const labels = Object.fromEntries((attributes.labels || []).map(label => [label.label, label.value]));
        if (!names.includes(attributes.name) || labels['iems.owner'] !== state.owner || labels['iems.issue'] !== 'TPR-139' || labels['iems.source'] !== state.sourceSha) throw new Error('Unexpected resource ownership in Terraform state');
        const kind = resource.type.slice('docker_'.length);
        const actual = JSON.parse(docker([kind === 'container' ? 'inspect' : kind, ...(kind === 'container' ? [] : ['inspect']), attributes.id]))[0];
        const actualLabels = kind === 'container' ? actual.Config?.Labels : actual.Labels;
        if (actual.Name.replace(/^\//, '') !== attributes.name || actualLabels?.['iems.owner'] !== state.owner || actualLabels?.['iems.source'] !== state.sourceSha) throw new Error('Terraform resource ID does not match live ownership');
      }
    }
  };
  if (action === 'up') {
    if (state.phase === 'DESTROYED') throw new Error('Destroyed state cannot be reused; choose a new private directory');
    verifyOwnership();
    verifyState();
    const mirror = process.env.PLATFORM_TF_PROVIDER_MIRROR;
    if (!mirror || !existsSync(mirror)) throw new Error('Installed offline Docker provider mirror required');
    await new Promise((resolvePort, reject) => {
      const socket = createServer(); socket.once('error', reject); socket.listen(state.apiPort, '127.0.0.1', () => socket.close(resolvePort));
    });
    if (!existsSync(tfDir)) cpSync(join(root, 'infra/terraform/local'), tfDir, { recursive: true });
    writeFileSync(tfEnv.TF_CLI_CONFIG_FILE, `provider_installation {\n filesystem_mirror {\n path = ${JSON.stringify(resolve(mirror).replaceAll('\\', '/'))}\n include = ["registry.terraform.io/kreuzwerker/docker"]\n }\n}\ndisable_checkpoint = true\n`, { mode: 0o600 });
    record('terraform', ['version', '-json'], { env: tfEnv, timeout: 10000 });
    writeFileSync(join(tfDir, 'owned.auto.tfvars.json'), JSON.stringify({ owner: state.owner, source_sha: state.sourceSha, image: state.image, api_port: state.apiPort, docker_host: dockerHost, rabbit_password: state.password }), { mode: 0o600 });
    record('docker', ['--host', dockerHost, 'build', '--file', 'ops/platform/Dockerfile', '--tag', state.image, '.'], { timeout: 600000 });
    terraform(['fmt', '-check']); terraform(['init', '-backend=false', '-input=false']); terraform(['validate', '-no-color']);
    terraform(['plan', '-input=false', '-out=owned.tfplan', '-no-color']);
    state.phase = 'APPLYING'; save();
    terraform(['apply', '-input=false', '-no-color', 'owned.tfplan']);
    verifyOwnership(); await health(); helper('seed', null, state.probePassword);
    state.phase = 'RUNNING'; save();
  } else if (action === 'health') { verifyOwnership(); await health(); }
  else if (action === 'verify') {
    verifyOwnership(); await health();
    const login = await fetch(`${api}/api/session/login`, { method: 'POST', headers: { Origin: api, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alpha.owner', password: state.probePassword }), signal: AbortSignal.timeout(10000) });
    if (!login.ok) throw new Error('Synthetic login failed');
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Synthetic session cookie missing');
    const headers = { Origin: api, 'Content-Type': 'application/json', Cookie: cookie };
    const response = await fetch(`${api}/api/platform/jobs`, { method: 'POST', headers, body: JSON.stringify({ kind: 'platform.persistence-probe', key: `probe-${randomBytes(8).toString('hex')}`, input: { value: state.owner } }), signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok || !body.data?.id) throw new Error('Real job API submission failed');
    state.probeJobId = body.data.id; save();
    let complete = false;
    for (let poll = 0; poll < 30; poll++) {
      const listing = await fetch(`${api}/api/platform/jobs`, { headers, signal: AbortSignal.timeout(5000) });
      const data = await listing.json();
      if (listing.ok && data.data?.some(j => j.id === state.probeJobId && j.status === 'SUCCEEDED')) { complete = true; break; }
      await delay(1000);
    }
    if (!complete) throw new Error('Job completion deadline exceeded');
    evidence.checks.push(JSON.parse(helper('verify', state.probeJobId)));
  } else if (action === 'restart') {
    verifyOwnership();
    if (!state.probeJobId) throw new Error('Run verify before persistence restart');
    evidence.checks.push(JSON.parse(helper('verify', state.probeJobId)));
    docker(['restart', '--timeout', '10', ...serviceNames]);
    await health(); evidence.checks.push(JSON.parse(helper('verify', state.probeJobId)));
    state.phase = 'RUNNING'; save();
  } else if (action === 'down') {
    verifyOwnership();
    verifyState();
    if (!existsSync(join(tfDir, 'terraform.tfstate'))) throw new Error('Owned Terraform state required; no manual container deletion');
    terraform(['plan', '-destroy', '-input=false', '-out=destroy.tfplan', '-no-color']);
    terraform(['apply', '-input=false', '-no-color', 'destroy.tfplan']);
    for (const list of [['ps', '-aq'], ['volume', 'ls', '-q'], ['network', 'ls', '-q']]) if (docker([...list, '--filter', `label=iems.owner=${state.owner}`])) throw new Error('Owned resources remain after teardown');
    state.phase = 'DESTROYED'; save();
  }
  evidence.status = 'PASS';
} catch (error) {
  evidence.status = error.result?.error?.code === 'ENOENT' ? 'NOT_RUN' : 'FAIL';
  evidence.error = error.message;
  process.exitCode = evidence.status === 'NOT_RUN' ? 2 : 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  const path = join(stateDir, `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${action}-result.json`);
  writeFileSync(path, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  closeSync(lockFd); unlinkSync(lock);
  console.log(JSON.stringify({ status: evidence.status, action, owner: state?.owner, evidence: path, error: evidence.error }));
}
