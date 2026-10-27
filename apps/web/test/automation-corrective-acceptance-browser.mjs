import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Runs against the owned integrated lab. It does not start or stop shared services.
// Private config supplies webUrl, username and password; no credential is emitted.
const configPath = process.env.IEMS_AUTOMATION_QA_CONFIG;
assert.ok(configPath, 'Set IEMS_AUTOMATION_QA_CONFIG to the private owned-lab config JSON');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const webUrl = config.webUrl || `http://127.0.0.1:${config.ports?.web || 5187}`;
const output = resolve(process.env.IEMS_AUTOMATION_QA_EVIDENCE || 'D:/Project AI/GITHUB/IEMS-evidence/n8n-corrective-acceptance-20261027/agent-c/browser');
await mkdir(output, { recursive: true });
const playwrightPath = process.env.IEMS_PLAYWRIGHT_MODULE;
assert.ok(playwrightPath, 'Set IEMS_PLAYWRIGHT_MODULE to the absolute index.mjs path of an explicitly installed Playwright QA package; see the lab runbook.');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const playwrightVersion = JSON.parse(await readFile(new URL('./package.json', pathToFileURL(playwrightPath)), 'utf8')).version;
const browser = await chromium.launch({ headless: true, executablePath: process.env.IEMS_QA_BROWSER_BINARY || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', args: ['--disable-background-networking', '--no-first-run'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const checks = [], requests = [], errors = [], screenshots = [], executions = [];
const check = (name, details = {}) => { checks.push({ name, ...details }); console.log(`PASS ${name}`); };
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  const u = new URL(request.url());
  if (u.protocol.startsWith('http')) requests.push({ method: request.method(), origin: u.origin, path: u.pathname });
});
const shot = async name => {
  const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: true });
  screenshots.push({ name, path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
};
const api = async (path, body) => page.evaluate(async ({ path, body }) => {
  const response = await fetch(`/portfolio-api/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, ...await response.json() };
}, { path, body });
const ok = async (path, body, status = 200) => { const r = await api(path, body); assert.equal(r.status, status, `${path}: ${JSON.stringify(r)}`); return r.data; };
const text = () => page.locator('body').innerText();
const click = label => page.getByRole('button', { name: label, exact: true }).click();
const settle = () => page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some(e => e.textContent === 'Loading current records...'));
const refresh = async () => { await click(config.labels?.refresh || 'Refresh records'); await page.getByRole('heading', { name: 'Automation Center', exact: true }).waitFor(); await settle(); };
const recordRun = async (label, workflowId, scope = page) => {
  const responsePromise = page.waitForResponse(r => r.url().includes(`/api/cs/automation/run/${workflowId}`) && r.request().method() === 'POST');
  await scope.getByRole('button', { name: label, exact: true }).click(); const response = await responsePromise; const result = await response.json();
  assert.ok(response.ok(), `${workflowId}: ${JSON.stringify(result)}`);
  const executionId = result.data?.executionId || result.data?.result?.n8nExecutionId || result.data?.result?.executionId;
  assert.ok(executionId, `${workflowId} must return an actual n8n execution reference`);
  executions.push({ workflowId, executionId, result }); return result;
};
let failure;
try {
  await page.goto(`${webUrl}/portfolio/service/automation`);
  await page.getByLabel('Username', { exact: true }).fill(config.username || 'alpha.owner');
  await page.getByLabel('Password', { exact: true }).fill(config.password);
  const signInResponse = page.waitForResponse(response => response.url().endsWith('/api/session/login') && response.request().method() === 'POST');
  await click('Sign in');
  assert.ok((await signInResponse).ok(), 'Synthetic human sign-in must succeed before navigation');
  await page.waitForURL(url => !url.pathname.endsWith('/portfolio/login'));
  await page.goto(`${webUrl}/portfolio/service/automation`);
  await page.getByRole('heading', { name: 'Automation Center', exact: true }).waitFor();
  check('N11 human browser sign-in and authoritative Automation Center');

  await click('Demo');
  await click('Create synthetic complaint');
  await page.getByRole('link', { name: 'Open demo ticket', exact: true }).waitFor();
  const source = await page.evaluate(() => JSON.parse(sessionStorage.getItem('iems-automation-demo')));
  assert.ok(source?.ticketId && source?.bindingId, 'Demo UI must persist supported API complaint identifiers');
  await writeFile(join(output, 'synthetic-source.json'), JSON.stringify(source, null, 2));
  await page.goto(`${webUrl}/portfolio/service/tickets/${source.ticketId}`);
  await page.getByRole('heading', { name: String(source.ticketNumber), exact: true }).waitFor();
  check('N02 supported API synthetic complaint visible in real browser', { ticketId: source.ticketId, ticketNumber: source.ticketNumber });
  await shot('source-complaint-1440');

  await page.goto(`${webUrl}/portfolio/service/automation`);
  await page.getByRole('heading', { name: 'Automation Center', exact: true }).waitFor();
  // Runtime demo policy is explicit and short; never change the system clock or source timestamps.
  const maxWait = config.demoSlaWaitMs || 90000;
  const deadline = Date.now() + maxWait;
  let alreadyEscalated = false;
  while (Date.now() < deadline) {
    await refresh();
    if ((await text()).includes(String(source.ticketNumber))) break;
    const current = await ok(`/cs/tickets/${source.ticketId}`);
    alreadyEscalated = current.history?.some(event => event.kind === 'SLA_ESCALATED');
    if (alreadyEscalated) break;
    await page.waitForTimeout(500);
  }
  assert.ok(alreadyEscalated || (await text()).includes(String(source.ticketNumber)), 'Supported complaint must become SLA eligible under documented demo policy');
  await recordRun(config.labels?.runEscalation || 'Run SLA scan in n8n', 'wf-sla-escalation');
  const escalated = await ok(`/cs/tickets/${source.ticketId}`);
  assert.equal(escalated.stage, 'NEW'); assert.ok(escalated.isEscalated || escalated.history?.some(e => e.kind?.includes('ESCALAT')));
  check('N02 N11 browser action invokes real n8n path and truthful escalation', { ticketId: source.ticketId });

  await page.goto(`${webUrl}/portfolio/service/tickets/${source.ticketId}`);
  await page.getByRole('heading', { name: String(source.ticketNumber), exact: true }).waitFor();
  const escalationHistory = page.locator('li').filter({ hasText: /SLA escalated/i });
  await escalationHistory.first().waitFor();
  assert.match(await escalationHistory.first().innerText(), /Internal\s*·\s*SLA escalated/);
  assert.match(await escalationHistory.first().innerText(), /Stage unchanged: New/);
  await shot('source-escalation-history-1440');
  for (const stage of ['TRIAGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED']) {
    const select = page.locator('select[name="toStage"]');
    const available = await select.locator('option').evaluateAll(options => options.map(o => o.value));
    assert.ok(available.includes(stage), `Expected legitimate next stage ${stage}; available: ${available.join(', ')}`);
    await select.selectOption(stage); await page.locator('[name="reason"]').fill(stage === 'RESOLVED' ? 'Synthetic issue resolved; local notification approved separately.' : 'Synthetic operator review');
    const responsePromise = page.waitForResponse(r => r.url().includes(`/api/cs/tickets/${source.ticketId}/stage`) && r.request().method() === 'POST');
    await click('Update stage'); const response = await responsePromise; assert.ok(response.ok(), await response.text());
    await page.waitForFunction(stage => document.querySelector('.pf-summary .pf-status')?.innerText.toLowerCase() === stage.toLowerCase().replaceAll('_', ' '), stage);
  }
  const resolvedSource = await ok(`/cs/tickets/${source.ticketId}`); assert.equal(resolvedSource.stage, 'RESOLVED');
  check('N07 human ticket resolution is separate from Send');
  await page.goto(`${webUrl}/portfolio/service/automation`);
  await page.getByRole('heading', { name: 'Automation Center', exact: true }).waitFor();
  await click(config.labels?.approvalsTab || 'Approvals');
  await page.getByLabel(/^Resolved source ticket/).selectOption(source.ticketId);
  await page.getByLabel(/^Synthetic recipient/).fill('browser-qa@iems.local');
  await page.getByLabel(/^Message for approval/).fill('Synthetic resolved notification approved in browser acceptance.');
  const createdResponse = page.waitForResponse(r => r.url().endsWith('/api/cs/automation/resolution-draft') && r.request().method() === 'POST');
  await click('Create draft for review');
  const creation = await createdResponse; const createdEnvelope = await creation.json();
  assert.equal(creation.status(), 201, JSON.stringify(createdEnvelope));
  const created = createdEnvelope.data;
  const id = created.draftId || created._id;
  const draftRow = page.locator(`[data-draft-id="${id}"]`);
  await draftRow.waitFor();
  assert.ok((await draftRow.innerText()).includes('browser-qa@iems.local'));
  await shot('approval-before-1440');
  const approvalResponse = page.waitForResponse(r => r.url().includes(`/resolution-drafts/${id}/approve`) && r.request().method() === 'POST');
  await draftRow.getByRole('button', { name: config.labels?.approve || 'Approve draft', exact: true }).click();
  assert.ok((await approvalResponse).ok());
  await settle();
  const beforeDispatch = await ok(`/cs/automation/resolution-drafts/${id}`);
  if (beforeDispatch.deliveryState === 'ACCEPTED_LOCAL') {
    const deliveries = await ok('/cs/automation/deliveries');
    const delivery = deliveries.find(row => row.draftId === id);
    const history = await ok('/cs/automation/audit-logs');
    const engineAudit = history.find(row => row.executionId && (row.targetEntity?.id === id || row.targetEntity?.id === delivery?.deliveryId));
    assert.ok(engineAudit, 'Scheduled recovery must retain an actual engine execution reference');
    executions.push({ workflowId: 'wf-automation-recovery', executionId: engineAudit.executionId, result: { draftId: id, deliveryId: delivery.deliveryId } });
  } else {
    await recordRun(config.labels?.runResolution || 'Dispatch approved update in n8n', 'wf-approved-resolution', draftRow);
  }
  await refresh();
  const dispatched = await ok(`/cs/automation/resolution-drafts/${id}`);
  assert.equal(dispatched.deliveryState, 'ACCEPTED_LOCAL', JSON.stringify(dispatched));
  assert.equal((await ok(`/cs/tickets/${source.ticketId}`)).version, resolvedSource.version);
  check('N06 N07 N08 N11 operator-approved actual-engine delivery with local receipt');
  await click('Automations');
  await recordRun(config.labels?.runDigest || 'Run demo digest in n8n', 'wf-cs-weekly-digest');
  check('N11 digest browser action uses real n8n proxy');

  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await refresh();
    for (const tab of ['Automations', 'Approvals', 'Runs and recovery', 'Demo']) {
      await click(tab);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow at ${width} in ${tab}`);
      await shot(`automation-${tab.replaceAll(' ', '-').toLowerCase()}-${width}`);
    }
    await page.getByRole('button', { name: 'Refresh records', exact: true }).focus();
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => { const e = document.activeElement; const s = e && getComputedStyle(e); return { tag: e?.tagName, label: e?.textContent?.trim().slice(0, 100), outline: s?.outlineStyle, outlineWidth: s?.outlineWidth }; });
    assert.ok(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(focused.tag), JSON.stringify(focused));
    assert.ok(focused.outline !== 'none' && focused.outlineWidth !== '0px', `No visible keyboard focus at ${width}: ${JSON.stringify(focused)}`);
    await page.getByRole('button', { name: 'Approvals', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('button', { name: 'Approvals', exact: true }).getAttribute('aria-pressed'), 'true');
    const undersized = await page.locator('#portfolio-content button').evaluateAll(buttons => buttons.filter(button => {
      const r = button.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44);
    }).map(button => ({ label: button.textContent.trim(), width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
    assert.deepEqual(undersized, [], `Controls smaller than 44px at ${width}`);
    await shot(`automation-keyboard-focus-${width}`);
    check(`N11 ${width}px no overflow and visible keyboard focus`, { focused });

    await click('Approvals');
    const currentSource = await ok(`/cs/tickets/${source.ticketId}`);
    const reviewPayload = { ticketId: source.ticketId, expectedTicketVersion: currentSource.version,
      channel: 'EMAIL', recipient: 'browser-qa@iems.local', proposedResolution: `Synthetic ${width}px review only; rejection must prevent dispatch.` };
    const rejectedDraft = await ok('/cs/automation/resolution-draft', reviewPayload, 201);
    const rejectedId = rejectedDraft.draftId || rejectedDraft._id;
    await refresh();
    const rejectionResponse = page.waitForResponse(r => r.url().includes(`/resolution-drafts/${rejectedId}/reject`) && r.request().method() === 'POST');
    await page.locator(`[data-draft-id="${rejectedId}"]`).getByRole('button', { name: 'Reject draft', exact: true }).click();
    assert.ok((await rejectionResponse).ok());
    await settle();
    assert.ok((await page.locator(`[data-draft-id="${rejectedId}"]`).innerText()).includes('REJECTED'));
    await shot(`approval-rejected-${width}`);

    const staleDraft = await ok('/cs/automation/resolution-draft', { ...reviewPayload, proposedResolution: `Synthetic ${width}px concurrent decision check.` }, 201);
    const staleId = staleDraft.draftId || staleDraft._id;
    await refresh();
    // A second operator's real API decision makes this displayed version stale.
    await ok(`/cs/automation/resolution-drafts/${staleId}/reject`, { expectedVersion: staleDraft.version });
    const staleResponse = page.waitForResponse(r => r.url().includes(`/resolution-drafts/${staleId}/approve`) && r.request().method() === 'POST');
    await page.locator(`[data-draft-id="${staleId}"]`).getByRole('button', { name: 'Approve draft', exact: true }).click();
    assert.equal((await staleResponse).status(), 409);
    await page.getByRole('alert').first().waitFor();
    assert.match((await page.getByRole('alert').allTextContents()).join(' '), /refresh|review|changed/i);
    await shot(`approval-stale-actionable-${width}`);
    await click('Runs and recovery');
    const reconciliationResponse = page.waitForResponse(r => r.url().endsWith('/api/cs/automation/reconcile') && r.request().method() === 'POST');
    await click('Reconcile delivery evidence');
    assert.ok((await reconciliationResponse).ok());
    await settle();
    check(`N11 ${width}px visible rejected decision, stale approval error and real reconciliation recovery`);

    await context.setOffline(true);
    await refresh();
    await page.getByRole('alert').first().waitFor();
    const errorText = await page.getByRole('alert').allTextContents();
    assert.ok(errorText.some(s => /retry|refresh|check|sign in/i.test(s)), JSON.stringify(errorText));
    await shot(`offline-actionable-error-${width}`);
    await context.setOffline(false); await page.reload();
    await page.getByRole('heading', { name: 'Automation Center', exact: true }).waitFor(); await settle();
    assert.equal(await page.getByRole('alert').count(), 0);
    check(`N11 ${width}px actionable unavailable-state error and refresh recovery`);
  }
  assert.equal(requests.some(r => r.origin === (config.sinkUrl || `http://127.0.0.1:${config.ports?.inspector || 8027}`) && r.path.startsWith('/api/emails')), false, 'Browser must not bypass scoped IEMS inspector');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  check('N12 no direct browser sink API and no uncaught page errors');
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  await shot('failure').catch(() => {});
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.setOffline(false).catch(() => {});
  const report = { observedAt: new Date().toISOString(), webUrl, playwrightVersion, browserVersion: browser.version(), testedSha: process.env.IEMS_TESTED_SHA || 'UNKNOWN', dirtyTreeQualification: process.env.IEMS_TESTED_TREE || 'UNFROZEN', checks, count: checks.length, failure, executions, requests, errors, screenshots };
  await writeFile(join(output, 'browser-results.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
