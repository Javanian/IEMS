import assert from 'node:assert/strict';

export async function quoteEditorInquiryJourney({ db, call, wait, fill, evaluate, check, headers }) {
  const api = async (path, body, status = 200) => {
    const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method: body ? 'POST' : 'GET', headers, ...(body && { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result.data;
  };
  const account = await api('/crm/accounts', { name: 'Synthetic quoteEditor known customer' }, 201);
  const credential = await db.collection('credentials').findOne({ username: 'alpha.owner' });
  const member = await db.collection('memberships').findOne({ userId: credential._id });
  await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: [{ role: 'quoteEditor', plantIds: [account.plantId] }] } });
  try {
    const identity = await api('/session/me');
    assert.ok(identity.permissions.includes('quote.write'));
    assert.equal(identity.permissions.includes('crm.read'), false);
    await api('/crm/accounts', undefined, 403);
    await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/inquiries/new` });
    await wait('document.querySelector("[name=accountId]:enabled")?.tagName === "INPUT"');
    assert.equal(await evaluate('Boolean(document.querySelector("select[name=accountId]"))'), false);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Save inquiry"]').innerText.includes('Access denied')`), false);
    const line = { itemCode: 'ROLE-PART', description: 'Synthetic known-account part', quantity: '1.250000', uom: 'EA', drawingNumber: 'ROLE-DRAW', drawingRevision: 'A' };
    await fill('accountId', account._id);
    for (const [field, value] of Object.entries(line)) await fill(`${field}0`, value);
    await evaluate('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent === "Save inquiry");b.focus()})()');
    assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
    await call('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await wait('document.body.innerText.includes("Inquiry ID:")&&document.body.innerText.includes("Stage: DRAFT")');
    const id = await evaluate('location.pathname.split("/").at(-1)');
    const row = await db.collection('inquiries').findOne({ _id: id });
    assert.equal(row.accountId, account._id);
    const { lineId, ...content } = row.revisions[0].lines[0];
    assert.ok(lineId);
    assert.deepEqual(content, line);
    const before = await evaluate('performance.timeOrigin');
    await call('Page.reload');
    await wait(`performance.timeOrigin!==${before}&&document.body.innerText.includes("Inquiry ID:")&&document.body.innerText.includes("ROLE-PART")`);
    assert.deepEqual(await db.collection('inquiries').findOne({ _id: id }), row);
    await api('/crm/accounts', undefined, 403);
    check('PR4 corrective quoteEditor known-account keyboard create and reload persist exact inquiry source while CRM browse stays denied');
  } finally {
    await db.collection('memberships').updateOne({ _id: member._id }, { $set: { roles: member.roles } });
    await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/inquiries/new` });
    const before = await evaluate('performance.timeOrigin');
    await call('Page.reload');
    await wait(`performance.timeOrigin!==${before}&&document.querySelector("select[name=accountId]:enabled")`);
  }
}
