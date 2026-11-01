import assert from 'node:assert/strict';
import { bindBusinessClock } from '../../../apps/portfolio-api/src/business-clock.mjs';
import { runE02Flow } from '../../../apps/portfolio-api/test/support/review-e02-flow.mjs';

const js = JSON.stringify, api = 'http://127.0.0.1:32401';
export function dispatchReadyCall(kit) {
  const selections = [];
  return async (method, params, ...rest) => {
    const result = await kit.call(method, params, ...rest);
    if (method === 'Page.navigate' && /\/portfolio\/fulfillment\/orders\//.test(params.url)) {
      await kit.wait('[...document.querySelectorAll("label")].some(label=>label.textContent.startsWith("Dispatch step")&&label.querySelector("select"))');
      await kit.evaluate('(()=>{const select=[...document.querySelectorAll("label")].find(label=>label.textContent.startsWith("Dispatch step")).querySelector("select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(select,"ship");select.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await kit.wait('document.querySelector(\'form[aria-label="Record shipment"]\')');
      selections.push({url:params.url,action:'Selected existing Record direct dispatch option before original shipment selector'});
      await kit.writeEvidence('dispatch-continuation.json',{originalUnadaptedStop:'browser-attempt7: default pick form; Record shipment selector absent',nativeSelections:selections,assertionsAndSelectorsUnchanged:true});
    }
    return result;
  };
}
export async function supplementalBefore({ call,wait,evaluate,click,fill,screenshot,check,headers,password,web,writeEvidence }) {
  await click('Sign out');
  await wait('document.querySelector("[name=username]")');
  const invalid = [];
  for (const username of ['alpha.owner', 'no-such-synthetic-identity']) {
    await fill('username', username); await fill('password', 'invalid-synthetic-password');
    await click('Sign in');
    await wait('document.querySelector("[role=alert]")?.innerText.includes("Credentials not recognized")');
    const state = await evaluate('({text:document.querySelector("[role=alert]").innerText,links:[...document.querySelectorAll("[role=alert] a")].map(a=>a.textContent),username:document.querySelector("[name=username]").value,disabled:document.querySelector("form button").disabled})');
    assert.equal(state.username, username); assert.equal(state.disabled, false); assert.deepEqual(state.links, []);
    assert.doesNotMatch(state.text, /session expired/i); invalid.push(state.text);
  }
  assert.equal(invalid[0], invalid[1]);
  await screenshot('invalid-credentials-desktop');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
  await screenshot('invalid-credentials-mobile390');
  await fill('username','alpha.owner'); await fill('password',password);
  assert.equal(await evaluate(`document.querySelector('[name=username]').value==='alpha.owner'&&document.querySelector('[name=password]').value===${js(password)}&&document.querySelector('form').checkValidity()`),true);
  await evaluate('document.querySelector("[name=password]").focus()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait('!document.querySelector("[name=username]")&&[...document.querySelectorAll("button")].some(button=>button.textContent==="Sign out")');
  const cookie = (await call('Network.getCookies',{urls:[web]})).cookies.find(row=>row.name==='portfolio_session');
  assert.ok(cookie?.httpOnly);
  const logout = await fetch(`${api}/api/session/logout`,{method:'POST',headers:{...headers,cookie:`portfolio_session=${cookie.value}`},body:'{}'});
  assert.equal(logout.status,200);
  await click('Work queue');
  await wait('document.querySelector("[role=alert]")?.innerText.includes("Your session expired")');
  assert.equal(await evaluate('document.querySelector("[role=alert] a").textContent'),'Sign in again');
  await screenshot('stale-session-mobile390');
  await click('Sign in again'); await wait('document.querySelector("[name=username]")');
  await fill('username','alpha.owner'); await fill('password',password); await click('Sign in');
  await wait('!document.querySelector("[name=username]")');
  const fresh = (await call('Network.getCookies',{urls:[web]})).cookies.find(row=>row.name==='portfolio_session');
  headers.cookie = `portfolio_session=${fresh.value}`;
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await writeEvidence('auth-browser.json',{invalidIdentityAndPasswordSameMessage:invalid[0]===invalid[1],credentialInputsRetained:true,keyboardSignIn:true,staleSessionExpiryAction:true,mobile390Overflow:false});
  check('Actual invalid identity/password produce identical correction guidance; keyboard sign-in and revoked-session 401 recovery succeed');
}

export async function supplementalAfter({ db,runtime,marker,call,wait,evaluate,screenshot,check,headers,password,web,seedIdentities,writeEvidence }) {
  if (process.env.TPR166_E01_ONLY === '1') return;
  let instant = new Date('2026-04-01T00:00:00Z');
  await bindBusinessClock(runtime,()=>instant,marker);
  const login = async username => {
    const response = await fetch(`${api}/api/session/login`,{method:'POST',headers:{origin:web,'content-type':'application/json'},body:JSON.stringify({username,password})});
    assert.equal(response.status,200); return response.headers.get('set-cookie').split(';')[0];
  };
  const req = async(path,body,cookie=headers.cookie,extraHeaders={}) => {
    const response = await fetch(`${api}/api${path}`,{method:body===undefined?'GET':'POST',headers:{...headers,cookie,...extraHeaders},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,...await response.json()};
  };
  const ok = async(path,body,status=200,cookie=headers.cookie) => {const result=await req(path,body,cookie);assert.equal(result.status,status,`${path}: ${JSON.stringify(result)}`);return result.data;};
  const flow = await runE02Flow({db,runtime,seeded:seedIdentities,alpha:headers.cookie,login,req,ok,scopeOf:cookie=>runtime.foundation.authenticate(cookie.slice('portfolio_session='.length))},{setClock:value=>instant=new Date(value),onCheckpoint:value=>writeEvidence('e02-progress.json',value)});
  await writeEvidence('e02-manifest.json',flow.manifest);
  const rows = await db.collection('fulfillmentShipments').find({sourceKind:'CUSTOMER_ASSET_RETURN'}).toArray();
  assert.equal(rows.length,2);
  for (const row of rows) {assert.equal(Object.hasOwn(row,'lineIndex'),false);assert.ok(row.caseId&&row.assetId&&row.serial);}
  await call('Page.navigate',{url:`${web}/portfolio/fulfillment/shipments`});
  await wait('document.querySelector(".pf-rows")?.innerText.includes("Customer asset")');
  const rendered = await evaluate(`[...document.querySelectorAll('.pf-rows li')].map(row=>({text:row.innerText,repair:row.querySelector(${js('a[href*="/repair/cases/"]')})?.getAttribute('href')}))`);
  assert.equal(rendered.length>=rows.length,true);
  for (const row of rows) {
    const actual=rendered.find(value=>value.repair===`/portfolio/repair/cases/${row.caseId}`);
    assert.ok(actual);assert.ok(actual.text.includes(row.serial));assert.doesNotMatch(actual.text,/Line\s+(NaN|\d+)/);
  }
  assert.doesNotMatch(rendered.map(row=>row.text).join('\n'),/NaN/);
  for (const width of [1440,390]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    await screenshot(`return-source-${width}`);
  }
  const repairLink=`a[href="/portfolio/repair/cases/${rows[0].caseId}"]`;
  await evaluate(`document.querySelector(${js(repairLink)}).focus()`);
  assert.equal(await evaluate(`document.activeElement.getAttribute('href')`),`/portfolio/repair/cases/${rows[0].caseId}`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await wait(`document.querySelector('h1')?.textContent.includes(${js(rows[0].serial)})`);
  await writeEvidence('return-browser.json',{rows:rows.map(({_id,caseId,assetId,serial,sourceKind})=>({_id,caseId,assetId,serial,sourceKind})),rendered,keyboardRepairNavigation:true,viewports:[1440,390],overflow:false});
  check('Original mounted E02 helper completes; accepted/rejected customer returns show actual serial and repair link without fabricated line; keyboard navigation works');
}
