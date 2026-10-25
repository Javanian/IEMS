import assert from 'node:assert/strict';
import { navigationContextChanged } from './browser-readiness.mjs';

// Shared Wave 4f browser helpers. Readiness always waits on the exact target element being present and enabled;
// there are no fixed sleeps. Values are set with the native setter plus input/change events, as earlier journeys do.
export const api = headers => async (path, body, extra = {}) => {
  const r = await fetch(`http://127.0.0.1:4313/api/${path}`, { method: body ? 'POST' : 'GET', headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
export const poster = request => async (path, body, extra) => { const r = await request(path, body, extra); assert.ok([200, 201].includes(r.status), `${path}: ${JSON.stringify(r)}`); return r.data; };
export const key = () => crypto.randomUUID();

const js = JSON.stringify;
// Scoped helpers, given an evaluate/wait pair bound to one CDP session.
export function scoped({ evaluate, wait }) {
  const control = (scope, name) => `(()=>{const f=document.querySelector(${js(scope)});return f?f.querySelector('[name=${name}]'):null})()`;
  async function fillIn(scope, name, value) {
    await wait(`(()=>{const x=${control(scope, name)};return Boolean(x&&!x.disabled&&!x.closest('fieldset:disabled'))})()`, `${scope} enabled [name=${name}]`);
    if (name === 'reasonCode' || name === 'contactId' || name === 'accountId') await wait(`(()=>{const x=${control(scope, name)};return x.tagName!=='SELECT'||[...x.options].some(o=>o.value===${js(value)})})()`, `${scope} option ${value}`);
    return evaluate(`(()=>{const x=${control(scope, name)};const p=x.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:x.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(x,${js(value)});x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));return x.value})()`);
  }
  const button = (scope, text) => `(()=>{const f=document.querySelector(${js(scope)});return f?[...f.querySelectorAll('button')].find(b=>b.textContent.trim()===${js(text)}):null})()`;
  async function clickIn(scope, text) {
    await wait(`(()=>{const b=${button(scope, text)};return Boolean(b&&!b.disabled)})()`, `${scope} enabled button ${text}`);
    assert.equal(await evaluate(`(()=>{const b=${button(scope, text)};if(!b||b.disabled)return false;b.click();return true})()`), true);
  }
  // A disabled control must explain itself through aria-describedby.
  async function disabledReason(scope, text) {
    await wait(`(()=>{const b=${button(scope, text)};return Boolean(b&&b.disabled&&b.getAttribute('aria-describedby'))})()`, `${scope} disabled ${text} with reason`);
    return evaluate(`(()=>{const b=${button(scope, text)};return document.getElementById(b.getAttribute('aria-describedby')).textContent})()`);
  }
  const link = (scope, text) => `(()=>{const f=document.querySelector(${js(scope)});return f?[...f.querySelectorAll('a')].find(a=>a.textContent.trim()===${js(text)}):null})()`;
  async function clickLink(scope, text) {
    await wait(`Boolean(${link(scope, text)})`, `${scope} link ${text}`);
    assert.equal(await evaluate(`(()=>{const a=${link(scope, text)};if(!a)return false;a.click();return true})()`), true);
  }
  const text = () => evaluate('document.body.innerText');
  return { fillIn, clickIn, clickLink, disabledReason, text };
}

// Isolated browser context (own cookie jar) for a second signed-in user, without revoking the owner's session.
export async function openContext({ call, web, password }, username, path) {
  const { browserContextId } = await call('Target.createBrowserContext', { disposeOnDetach: true }, null);
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId }, null);
  const sessionId = (await call('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
  const c = (method, params = {}) => call(method, params, sessionId);
  await c('Runtime.enable'); await c('Page.enable');
  await c('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => { const r = await c('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const wait = async (expression, label = expression) => {
    for (let i = 0; i < 300; i++) { try { if (await evaluate(`Boolean(document.body && (${expression}))`)) return; } catch(error) { if(!navigationContextChanged(error))throw error; } await new Promise(r => setTimeout(r, 100)); }
    throw Error(`Timed out (${username}): ${label}. Page: ${await evaluate('document.body.innerText')}`);
  };
  const kit = scoped({ evaluate, wait });
  await c('Page.navigate', { url: `${web}${path}` });
  await wait(`document.querySelector('[name=username]')`, 'login form');
  await kit.fillIn('form', 'username', username); await kit.fillIn('form', 'password', password); await kit.clickIn('form', 'Sign in');
  await wait(`location.pathname===${js(path.split('?')[0])} && !document.querySelector('[name=username]')`, `${username} deep link after sign in`);
  const cookie = (await call('Storage.getCookies', { browserContextId }, null)).cookies.find(x => x.name === 'portfolio_session');
  assert.ok(cookie, `${username} session cookie`);
  return { ...kit, call: c, evaluate, wait, cookie: `portfolio_session=${cookie.value}`, async close() { await call('Target.closeTarget', { targetId }, null); await call('Target.disposeBrowserContext', { browserContextId }, null).catch(() => {}); } };
}
