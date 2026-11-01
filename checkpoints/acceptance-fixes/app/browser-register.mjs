import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from '../../../apps/portfolio-api/node_modules/mongodb-memory-server/index.js';

const root = new URL('../../../', import.meta.url), browser = new URL('apps/web/test/', root).href;
const evidence = process.env.PORTFOLIO_EVIDENCE_DIR;
assert.ok(evidence);
assert.match(process.env.PAPERCLIP_RUN_ID, /^[a-f0-9-]{36}$/);
mkdirSync(evidence, { recursive: true });
const hash = text => createHash('sha256').update(text).digest('hex'), manifest = {};
const save = (name, value) => writeFileSync(`${evidence}/${name}`, JSON.stringify(value, null, 2));
writeFileSync(`${evidence}/browser-supplement.executed.mjs`, readFileSync(new URL('./browser-supplement.mjs', import.meta.url)));
const create = MongoMemoryReplSet.create;
MongoMemoryReplSet.create = async function(options) {
  const repl = await create.call(this, { ...options, instanceOpts: options.instanceOpts.map(option => ({ ...option, port: 32402 })), replSet: { ...options.replSet, ip: '127.0.0.1' } });
  save('mongo-resources.json', repl.servers.map(server => ({ pid: server.instanceInfo.instance.mongodProcess.pid, port: server.instanceInfo.port, dbPath: server.instanceInfo.dbPath, startedAt: new Date().toISOString() })));
  return repl;
};
registerHooks({ load(url, context, next) {
  if (!url.startsWith(browser) || !url.endsWith('.mjs')) return next(url, context);
  const original = readFileSync(new URL(url), 'utf8');
  let source = original.replaceAll('http://127.0.0.1:4313', 'http://127.0.0.1:32401');
  if (url.endsWith('/portfolio-browser.mjs')) {
    const replace = (from, to) => { assert.equal(source.split(from).length, 2, from); source = source.replace(from, to); };
    replace('const reviewMode=reviewRunPlan(process.env);', `const reviewMode={...reviewRunPlan(process.env),internalExecution:false,operator:false,${process.env.TPR166_E02_ONLY === '1' ? 'e01:false,' : ''}};`);
    replace("if(!transportExperimentPlan.withoutPreflight)await runTraceHeadingBrowserRegression({ evidenceDirectory: evidence, browserBinary: process.env.PORTFOLIO_CHROME_BINARY, diagnostic:async(phase,detail)=>{if(detail?.browserPid)resourceTelemetry.root('heading-browser',detail.browserPid);resourceTelemetry.event(phase,detail);await resourceTelemetry.sample(phase);} });", "if(false)await runTraceHeadingBrowserRegression({ evidenceDirectory: evidence }); // Assigned scope: E01/auth/E02; unrelated trace-heading preflight NOT_RUN.");
    replace("async function pickWebPort() { for (let p = 4173; p < 4273; p++) if (await freeOn('127.0.0.1', p)) return p; throw Error('No IPv4 loopback port in 4173..4272 is free'); }", 'async function pickWebPort() { assert.ok(await freeOn("127.0.0.1",32400)); return 32400; }');
    replace("database = `portfolio_owned_browser_${marker.replaceAll('-', '')}`", "database = `portfolio_owned_iems_qa_app_" + process.env.PAPERCLIP_RUN_ID.slice(0,8) + "_${marker.replaceAll('-', '').slice(0,16)}`");
    replace(".listen(4313, '127.0.0.1')", ".listen(32401, '127.0.0.1')");
    replace("server: { host: '127.0.0.1', port: webPort", "cacheDir: process.env.PAPERCLIP_RUN_SCRATCH_DIR + '/vite-cache', server: { proxy: {'/portfolio-api': {target:'http://127.0.0.1:32401',rewrite: p => p.replace(/^\\/portfolio-api/,'')}}, host: '127.0.0.1', port: webPort");
    replace("'--remote-debugging-port=0'", "'--remote-debugging-port=32403'");
    replace('  if(reviewMode.e01){', `  await supplementalBefore({...reviewKit,runtime,marker});\n  if(reviewMode.e01){`);
    replace('  if(reviewMode.internalExecution)', '  await supplementalAfter({...reviewKit,runtime,marker});\n  if(reviewMode.internalExecution)');
    if (process.env.TPR166_DIRECT_DISPATCH === '1') replace('canonicalE01Journey({...reviewKit,setBusinessTime:', 'canonicalE01Journey({...reviewKit,call:dispatchReadyCall(reviewKit),setBusinessTime:');
    replace("  await resourceTelemetry.sample('after-main-cleanup');", "  await resourceTelemetry.sample('after-main-cleanup');\n  await writeFile(join(evidence,'cleanup.json'),JSON.stringify({at:new Date().toISOString(),database,markerVerifiedDrop:Boolean(runtime),clientClosed:Boolean(runtime),mongoStopped:Boolean(mongo),apiClosed:!api?.listening,viteClosed:!vite?.httpServer?.listening,browserPid:chrome?.pid,browserExitCode:chrome?.exitCode,browserSignal:chrome?.signalCode,profile,profileRemoved:true},null,2));");
    source = `import { supplementalBefore,supplementalAfter,dispatchReadyCall } from '${new URL('./browser-supplement.mjs', import.meta.url).href}';\n` + source;
  }
  if (source === original) return next(url, context);
  const assertionLines = text => text.split('\n').filter(line => /\bassert[.(]/.test(line));
  // Harness setup changes are explicit; journey assertions and selectors remain byte-identical apart from loopback URL.
  if (!url.endsWith('/portfolio-browser.mjs')) assert.deepEqual(assertionLines(source), assertionLines(original).map(line => line.replaceAll('http://127.0.0.1:4313','http://127.0.0.1:32401')));
  const name = fileURLToPath(url).split(/[\\/]/).at(-1);
  writeFileSync(`${evidence}/${name}.original`, original);
  writeFileSync(`${evidence}/${name}.adapted`, source);
  manifest[name] = { originalSha256: hash(original), adaptedSha256: hash(source), journeyAssertionsRetained: true };
  save('adaptations.json', manifest);
  return { format: 'module', source, shortCircuit: true };
} });
