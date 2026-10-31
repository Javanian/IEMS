import assert from 'node:assert/strict';

export async function reconcileCommercialNoEffect({ evaluate, wait, click }, verify, evidence) {
  assert.ok(evidence.trim().length >= 12);
  await verify();
  await wait(`document.querySelector('section[aria-label="Pending command"]')`);
  assert.equal(await evaluate(`document.querySelector('section[aria-label="Pending command"] details button').disabled`), true);
  await evaluate(`(()=>{const section=document.querySelector('section[aria-label="Pending command"]');section.querySelector('details').open=true;const input=section.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(evidence)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Confirmed no effect; discard attempt');
  await wait(`!document.querySelector('section[aria-label="Pending command"]')`);
}
