import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { freemem, totalmem } from 'node:os';

let observerWarnings = 0;
export async function observeTransport(callback, ...args) {
  try { return await callback?.(...args); }
  catch(error) { if(observerWarnings++ < 8) console.warn('Transport observer unavailable:',error.code || error.name); }
}

export function transportExperiment(env, plan) {
  const flag = env.PORTFOLIO_TRANSPORT_WITHOUT_PREFLIGHT;
  if (flag !== undefined && !['0', '1'].includes(flag)) throw Error('PORTFOLIO_TRANSPORT_WITHOUT_PREFLIGHT must be 0 or 1');
  if (flag === '1' && !(plan.diagnosticOnly && plan.companyOnly && plan.companyTrace)) throw Error('Without-preflight transport experiment requires company-only trace diagnostic mode; never full acceptance');
  return { withoutPreflight: flag === '1', variant: flag === '1' ? 'B-diagnostic-without-preflight' : 'A-with-preflight' };
}

export function safeTransportURL(value) {
  try { const url = new URL(value); return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? `${url.origin}${url.pathname}` : '[external]'; }
  catch { return '[unavailable]'; }
}

export function ownedInventory(rows, roots, known = new Map(), excludedPid) {
  const eligible = rows.filter(row => row.pid !== excludedPid), owned = new Set();
  for (const row of eligible) {
    const key = `${row.pid}:${row.createdUTC}`;
    if (known.has(key) || roots.some(root => root.pid === row.pid && (root.createdUTC ? root.createdUTC === row.createdUTC : Number.isFinite(Date.parse(row.createdUTC)) && Date.parse(row.createdUTC) <= Date.parse(root.registeredUTC)))) owned.add(row.pid);
  }
  for (let pass = 0; pass < eligible.length; pass++) {
    let changed = false;
    for (const row of eligible) {
      const parent=eligible.find(candidate=>candidate.pid===row.parentPid);
      if (!owned.has(row.pid) && owned.has(row.parentPid) && parent && Number.isFinite(Date.parse(row.createdUTC)) && Date.parse(row.createdUTC)>=Date.parse(parent.createdUTC) && ![...known.keys()].some(key => key.startsWith(`${row.pid}:`) && key !== `${row.pid}:${row.createdUTC}`)) { owned.add(row.pid); changed = true; }
    }
    if (!changed) break;
  }
  return eligible.filter(row => owned.has(row.pid));
}

const windowsSample = String.raw`
$ErrorActionPreference='Stop'
$rows=@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;createdUTC=$_.CreationDate.ToUniversalTime().ToString('o');name=$_.Name;workingSetBytes=[long]$_.WorkingSetSize;privateBytes=[long]$_.PrivatePageCount;handles=[int]$_.HandleCount} })
$os=Get-CimInstance Win32_OperatingSystem
$memory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$tcpError=$null;$tcp=@();try {$tcp=@(Get-NetTCPConnection -ErrorAction Stop | ForEach-Object { [pscustomobject]@{pid=[int]$_.OwningProcess;state=[string]$_.State;localPort=[int]$_.LocalPort} })}catch {$tcpError=$_.Exception.GetType().Name}
$range=@(netsh int ipv4 show dynamicport tcp | ForEach-Object {if($_ -match ':\s*(\d+)') {[int]$Matches[1]}})
@{processes=$rows;hostProcessCount=$rows.Count;os=$os.Caption;osVersion=$os.Version;freeBytes=[long]$os.FreePhysicalMemory*1024;committedBytes=[long]$memory.CommittedBytes;commitLimitBytes=[long]$memory.CommitLimit;tcp=$tcp;tcpUnavailable=$tcpError;samplerPid=$PID;dynamicTcpRange=$range} | ConvertTo-Json -Depth 5 -Compress
`;

export function transportResourceTelemetry(evidence, { experiment, maxSnapshots = 16, eventLimit = 1024, maxBytes = 1024 * 1024, sampler } = {}) {
  const roots = [], known = new Map(), snapshots = [], events = [], requests = new Map();
  let droppedEvents = 0, droppedSnapshots = 0, droppedRequests = 0, queue = Promise.resolve();
  const stamp = () => new Date().toISOString();
  function event(kind, detail = {}) {
    events.push({ utc: stamp(), kind, ...detail });
    if (events.length > eventLimit) { events.shift(); droppedEvents++; }
  }
  function root(role, pid) { if (Number.isInteger(pid)) { roots.push({ role, pid, registeredUTC:stamp(), identity:'pending-OS-observation' }); event('owned-root', { role, pid }); } }
  root('harness', process.pid);
  async function collect() {
    if (sampler) return sampler();
    if (process.platform !== 'win32') return { unavailable: 'Windows process/socket sampler unavailable on this platform', freeBytes: freemem(), totalBytes: totalmem() };
    return new Promise(resolve => execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsSample], { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) resolve({ unavailable: error.killed ? 'SAMPLER_TIMEOUT' : error.code || error.name });
      else { try { resolve(JSON.parse(stdout)); } catch { resolve({ unavailable: 'SAMPLER_INVALID_JSON' }); } }
    }));
  }
  async function flush() {
    const state = { schema: 'TRANSPORT_RESOURCE_DIAGNOSTIC_V1', capturedUTC: stamp(), platform: process.platform, experiment, bounds: { maxSnapshots, eventLimit, maxBytes, samplerTimeoutMs: 8000 }, droppedEvents, droppedSnapshots, droppedRequests, roots, snapshots, events, limits: 'Point-in-time observer; sampling adds measured delay. No continuous peaks, kernel allocation attribution or historical closure inferred. Missing counters are unknown, not zero.' };
    let serialized = JSON.stringify(state, null, 2);
    while (Buffer.byteLength(serialized) > maxBytes && state.events.length) { state.events = state.events.slice(1); state.droppedEvents++; serialized = JSON.stringify(state, null, 2); }
    if (Buffer.byteLength(serialized) > maxBytes) serialized = JSON.stringify({ schema: state.schema, unavailable: 'TELEMETRY_SIZE_LIMIT', maxBytes });
    queue = queue.catch(() => {}).then(() => writeFile(join(evidence, 'transport-resource-telemetry.json'), serialized + '\n')).catch(error => console.warn('Resource telemetry write unavailable:', error.code || error.name));
    await queue;
  }
  async function sample(phase) {
    if (snapshots.length >= maxSnapshots) { droppedSnapshots++; return; }
    const startedUTC = stamp(), started = performance.now();
    let raw;try {raw=await collect();} catch(error){raw={unavailable:error.code||error.name};}
    const inventory = raw.processes ? ownedInventory(raw.processes, roots, known, raw.samplerPid) : null;
    if (inventory) for (const row of inventory) {
      const key = `${row.pid}:${row.createdUTC}`; known.set(key, row);
      for (const entry of roots) if (entry.pid === row.pid && !entry.createdUTC) {entry.createdUTC = row.createdUTC;entry.identity='OS-creation-time-observed';}
    }
    const states = rows => rows.reduce((counts, row) => { counts[row.state] = (counts[row.state] || 0) + 1; return counts; }, {});
    const dynamicTcpRange=raw.dynamicTcpRange?.length===2?{start:raw.dynamicTcpRange[0],count:raw.dynamicTcpRange[1]}:null;
    snapshots.push({ phase, startedUTC, completedUTC: stamp(), overheadMs: Math.round(performance.now() - started), ...(raw.unavailable ? { unavailable: raw.unavailable } : {}), node:{memory:process.memoryUsage(),activeResourceTypes:process.getActiveResourcesInfo().slice(0,128)}, host: { os: raw.os, version: raw.osVersion, freeBytes: raw.freeBytes, totalBytes: raw.totalBytes, committedBytes: raw.committedBytes, commitLimitBytes: raw.commitLimitBytes, processCount: raw.hostProcessCount, tcpStates: raw.tcpUnavailable ? null : raw.tcp ? states(raw.tcp) : null, tcpUnavailable: raw.tcpUnavailable,dynamicTcpRange,dynamicTcpEntries:dynamicTcpRange&&raw.tcp&&!raw.tcpUnavailable?raw.tcp.filter(row=>row.localPort>=dynamicTcpRange.start&&row.localPort<dynamicTcpRange.start+dynamicTcpRange.count).length:null }, owned: inventory?.map(row => ({ ...row, tcpStates: raw.tcpUnavailable ? null : raw.tcp ? states(raw.tcp.filter(connection => connection.pid === row.pid)) : null })) ?? null, previouslyObservedAbsent: inventory ? [...known.values()].filter(row => !raw.processes.some(current => current.pid === row.pid && current.createdUTC === row.createdUTC)).map(({pid,createdUTC,name}) => ({pid,createdUTC,name})) : null });
    await flush();
  }
  function cdp(message) {
    const p = message.params || {}, identity = { sessionId: message.sessionId };
    const requestKey=`${message.sessionId || 'browser'}:${p.requestId}`;
    if (message.method === 'Network.requestWillBeSent' && p.request?.method === 'GET' && /\/company-stock\/receipts\/[^/]+\/units\/[^/]+\/trace$/.test(safeTransportURL(p.request.url))) {
      if (requests.size >= 256) { requests.delete(requests.keys().next().value); droppedRequests++; }
      const row = { ...identity, requestId: p.requestId, frameId: p.frameId, loaderId: p.loaderId, url: safeTransportURL(p.request.url), method: p.request.method, timestamp: p.timestamp, wallTime: p.wallTime }; requests.set(requestKey, row); event('trace-request', row);
    }
    if (['Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed'].includes(message.method) && requests.has(requestKey)) {
      event(message.method, { ...requests.get(requestKey), timestamp: p.timestamp, status: p.response?.status, errorText: p.errorText, canceled: p.canceled });
      if (message.method !== 'Network.responseReceived') requests.delete(requestKey);
    }
    if (message.method === 'Page.frameNavigated') event('frame-navigated', { ...identity, frameId: p.frame.id, loaderId: p.frame.loaderId, url: safeTransportURL(p.frame.url) });
    if (['Inspector.targetCrashed', 'Target.targetCrashed', 'Target.detachedFromTarget'].includes(message.method)) event(message.method, { ...identity, targetId: p.targetId });
    if(['Target.targetCreated','Target.targetDestroyed'].includes(message.method))event(message.method,{targetId:p.targetId||p.targetInfo?.targetId,url:p.targetInfo?.url?safeTransportURL(p.targetInfo.url):undefined});
  }
  return { root, event, sample:phase=>observeTransport(sample,phase), cdp:message=>{try{cdp(message);}catch(error){event('cdp-observer-unavailable',{errorName:error.name});}}, flush:()=>observeTransport(flush) };
}
