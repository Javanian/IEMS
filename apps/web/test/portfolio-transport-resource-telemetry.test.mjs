import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transportExperiment, safeTransportURL, ownedInventory, transportResourceTelemetry, observeTransport } from './transport-resource-telemetry.mjs';
import { reviewRunPlan } from './portfolio-review-mode.mjs';

test('without-preflight experiment is rejected outside company-only trace diagnostics', () => {
  for (const env of [{}, { PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY: '1' }, { PORTFOLIO_REVIEW_DEBUG_ONLY: '1', PORTFOLIO_COMPANY_STOCK_TRACE: '1' }]) {
    assert.throws(() => transportExperiment({ ...env, PORTFOLIO_TRANSPORT_WITHOUT_PREFLIGHT: '1' }, reviewRunPlan(env)), /never full acceptance/);
  }
  const env = { PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY: '1', PORTFOLIO_COMPANY_STOCK_TRACE: '1', PORTFOLIO_TRANSPORT_WITHOUT_PREFLIGHT: '1' };
  assert.equal(transportExperiment(env, reviewRunPlan(env)).withoutPreflight, true);
  assert.equal(reviewRunPlan(env).priorJourneyCoverage, false);
  assert.equal(transportExperiment({}, reviewRunPlan({})).withoutPreflight, false);
  assert.throws(() => transportExperiment({ PORTFOLIO_TRANSPORT_WITHOUT_PREFLIGHT: 'yes' }, {}));
});

test('ownership retains observed descendants after root exits and rejects reused PID', () => {
  const dates=['2026-10-27T00:00:00Z','2026-10-27T00:00:01Z','2026-10-27T00:00:02Z','2026-10-27T00:00:03Z','2026-10-27T00:00:04Z'];
  const rows = [{ pid: 10, parentPid: 1, createdUTC: dates[0] }, { pid: 11, parentPid: 10, createdUTC: dates[1] }, { pid: 12, parentPid: 11, createdUTC: dates[2] }, { pid: 13, parentPid: 10, createdUTC: dates[3] }, { pid: 99, parentPid: 1, createdUTC: dates[4] }];
  const roots = [{ pid: 10, createdUTC: dates[0] }], initial = ownedInventory(rows, roots, new Map(), 13);
  assert.deepEqual(initial.map(row => row.pid), [10, 11, 12]);
  const known = new Map(initial.map(row => [`${row.pid}:${row.createdUTC}`, row]));
  assert.deepEqual(ownedInventory([{ ...rows[1], parentPid: 1 }, { ...rows[2], createdUTC: 'REUSED', parentPid: 1 }], roots, known).map(row => row.pid), [11]);
  assert.deepEqual(ownedInventory([rows[0],{pid:20,parentPid:10,createdUTC:'2026-10-26T00:00:00Z'}],roots).map(row=>row.pid),[10]);
});

test('request telemetry strips query/auth/headers/bodies and associates session/frame/errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'iems-transport-unit-'));
  try {
    const telemetry = transportResourceTelemetry(directory);
    telemetry.cdp({ sessionId: 'session', method: 'Network.requestWillBeSent', params: { requestId: '1', frameId: 'frame', loaderId: 'loader', request: { method: 'GET', url: 'http://user:password@127.0.0.1:4173/company-stock/receipts/r/units/u/trace?token=secret', headers: { Authorization: 'secret' }, postData: 'private-body' } } });
    telemetry.cdp({sessionId:'other-session',method:'Network.loadingFailed',params:{requestId:'1',errorText:'WRONG_SESSION'}});
    telemetry.cdp({ sessionId:'session',method: 'Network.loadingFailed', params: { requestId: '1', errorText: 'net::ERR_NO_BUFFER_SPACE', canceled: false } });
    await telemetry.flush();
    const text = await readFile(join(directory, 'transport-resource-telemetry.json'), 'utf8'), state = JSON.parse(text);
    assert.doesNotMatch(text, /password|Authorization|secret|private-body|token=/);
    assert.doesNotMatch(text,/WRONG_SESSION/);
    assert.equal(state.events.at(-1).frameId, 'frame'); assert.equal(state.events.at(-1).sessionId, 'session');
    assert.equal(state.events.at(-1).errorText, 'net::ERR_NO_BUFFER_SPACE');
    assert.equal(safeTransportURL('https://external.invalid/private?secret=1'), '[external]');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('observer failures cannot replace original failure or prevent subsequent cleanup',async()=>{
  const original=Error('actual trace failure');let closed=false;
  await assert.rejects(async()=>{try{throw original;}catch(error){await observeTransport(async()=>{throw Error('observer write failed');});throw error;}finally{await observeTransport(()=>{throw Error('observer before cleanup failed');});closed=true;}},error=>error===original);
  assert.equal(closed,true);
});

test('root identity absent at first sample cannot adopt a later reused PID',()=>{
  const root={pid:10,registeredUTC:'2026-10-28T00:00:00Z'};
  assert.deepEqual(ownedInventory([{pid:10,parentPid:1,createdUTC:'2026-10-28T00:00:01Z'}],[root]),[]);
  assert.equal(ownedInventory([{pid:10,parentPid:1,createdUTC:'2026-10-27T23:59:59Z'}],[root]).length,1);
});

test('request inventory and serialized byte size remain bounded',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'iems-transport-unit-'));
  try {
    const telemetry=transportResourceTelemetry(directory,{eventLimit:8});
    for(let id=0;id<300;id++)telemetry.cdp({sessionId:'s',method:'Network.requestWillBeSent',params:{requestId:String(id),request:{method:'GET',url:'http://127.0.0.1/company-stock/receipts/r/units/u/trace'}}});
    await telemetry.flush();const state=JSON.parse(await readFile(join(directory,'transport-resource-telemetry.json'),'utf8'));
    assert.equal(state.droppedRequests,44);assert.equal(state.events.length,8);
    const bounded=transportResourceTelemetry(directory,{maxBytes:1024});bounded.event('large',{text:'x'.repeat(10000)});await bounded.flush();
    assert.ok((await readFile(join(directory,'transport-resource-telemetry.json'))).length<=1025);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('bounded observer reports unavailable separately from zero and counts evictions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'iems-transport-unit-'));
  try {
    const telemetry = transportResourceTelemetry(directory, { eventLimit: 3, maxSnapshots: 1, sampler: async () => ({ unavailable: 'SAMPLER_TIMEOUT' }) });
    for (let index = 0; index < 10; index++) telemetry.event('marker', { index });
    await telemetry.sample('before'); await telemetry.sample('after'); await telemetry.flush();
    const state = JSON.parse(await readFile(join(directory, 'transport-resource-telemetry.json'), 'utf8'));
    assert.equal(state.events.length, 3); assert.equal(state.droppedEvents, 8); assert.equal(state.droppedSnapshots, 1);
    assert.equal(state.snapshots[0].owned, null); assert.equal(state.snapshots[0].host.tcpStates, null); assert.equal(state.snapshots[0].unavailable, 'SAMPLER_TIMEOUT');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
