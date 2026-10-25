import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseExpression } from '@babel/parser';
import { scoped } from './wave4f-browser-kit.mjs';

const js = JSON.stringify, select = title => `form[aria-label="${title}"]`;
const INSPECT = select('Save catalog receipt inspection'), APPROVE = select('Approve catalog receipt inspection'), PUTAWAY = select('Put away accepted catalog stock');

export async function catalogDispositionJourney({ db, call, wait, click, evaluate, screenshot, check, headers, loseResponse }) {
  const checked = expression => { parseExpression(expression); return evaluate(expression); };
  const ready = expression => { parseExpression(expression); return wait(expression); };
  const form = scoped({ evaluate: checked, wait: ready });
  const common = version => ({ expectedVersion: version, reason: 'Synthetic controlled QC evidence', idempotencyKey: randomUUID() });
  const send = async (path, body, extra = {}) => { const response = await fetch(`http://127.0.0.1:4313/api${path}`, { method: body ? 'POST' : 'GET', headers: { ...headers, ...extra }, ...(body && { body: JSON.stringify(body) }) }); return { status: response.status, ...await response.json() }; };
  const api = async (path, body, extra) => { const response = await send(path, body, extra); assert.ok([200, 201].includes(response.status), `${path}: ${JSON.stringify(response)}`); return response.data; };
  const base = receipt => `/catalog-disposition/receipts/${receipt._id}`, view = receipt => api(base(receipt));
  const version = value => `document.querySelector('#catalog-receipt-qc')?.getAttribute('data-inspection-version')===${js(String(value))}`;
  const navigate = async receipt => { const current = await view(receipt), path = `/portfolio/catalog-disposition/receipts/${receipt._id}`; await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}${path}` }); await ready(`location.pathname===${js(path)}&&${version(current.version)}&&document.querySelector('#catalog-receipt')?.getAttribute('data-receipt-version')===${js(String(current.receiptVersion))}`); };
  const snapshot = names => Promise.all(names.map(name => db.collection(name).find().sort({ _id: 1 }).toArray()));
  const stockNames = ['catalogDispositionHeads', 'catalogInspections', 'catalogDispositionEvents', 'catalogStockBalances', 'catalogStockUnits', 'catalogStockMovements', 'catalogDispositionKeys', 'catalogDispositionAudit', 'catalogDispositionOutbox', 'warehouseReceipts', 'warehouseReceiptOrigins', 'warehouseMovements', 'warehouseSerials', 'inventoryItems', 'companyLocations', 'warehouseBins'];
  const stock = () => snapshot(stockNames), forbiddenNames = ['salesOrders', 'manufacturingWorkOrders', 'manufacturingOutputUnits', 'manufacturingMovements', 'warehouseReservations', 'serialCustodyUnits', 'serialCustodyClaims', 'componentInstallationLinks', 'fulfillmentShipments', 'fulfillmentInvoices', 'fulfillmentPayments', 'internalProductionOrders', 'internalEngineeringRevisions'];
  const beforeForbidden = await snapshot(forbiddenNames);
  const vendor = await api('/procurement/vendors', { name: 'Synthetic controlled QC supplier' }), items = [];
  for (const [policy, uom] of [['LOT', 'KG'], ['SERIAL', 'UN']]) {
    const draft = await api('/inventory-master/items', { ...common(1), code: `SYNTH-QC-${policy}`, description: `Synthetic controlled ${policy} item`, uom, kind: 'PURCHASED', schema: 'INVENTORY_ITEM_V2', trackingPolicy: policy });
    items.push(await api(`/inventory-master/items/${draft._id}/approve`, { ...common(draft.version), revision: 1 }));
  }
  const bin = await api('/warehouse/bins', { expectedVersion: 1, code: 'SYNTH-QC-STOCK', idempotencyKey: randomUUID() });
  const draftLocation = await api('/inventory-master/locations', { ...common(1), code: 'SYNTH-QC-LOCATION', binId: bin._id });
  const location = await api(`/inventory-master/locations/${draftLocation._id}/qualify`, common(draftLocation.version));
  let request = await api('/catalog-procurement/requests', { ...common(1), vendorId: vendor._id, taxPolicy: 'NO_TAX', roundingPolicy: 'LINE_HALF_UP', lines: items.map((item, i) => ({ itemId: item._id, itemVersion: item.version, itemRevision: item.currentRevision, quantity: i ? '3' : '3.5', unitPrice: '1.00', currency: 'USD' })) });
  request = await api(`/catalog-procurement/requests/${request._id}/approve`, { ...common(request.version), revision: request.currentRevision });
  let order = await api(`/catalog-procurement/requests/${request._id}/convert`, common(request.version)); order = await api(`/catalog-procurement/orders/${order._id}/issue`, common(order.version));
  const receive = (lineIndex, quantity, serials = []) => api('/catalog-procurement/receipts', { ...common(order.version), purchaseOrderId: order._id, vendorId: vendor._id, lineId: order.content.lines[lineIndex].lineId, quantity, serials, lotNumber: `SYNTH-QC-LOT-${lineIndex}`, heatNumber: 'SYNTH-QC-HEAT' });
  const lot = await receive(0, '2.5'), serial = await receive(1, '3', ['SYNTH_QC_A', 'SYNTH_QC_B', 'SYNTH_QC_C']), rejected = await receive(0, '1');
  const immutableNames = ['warehouseReceiptOrigins', 'warehouseMovements', 'warehouseSerials'], immutable = await snapshot(immutableNames);
  const many = async (name, values) => {
    await ready(`document.querySelector(${js(INSPECT)})?.querySelector('[name=${name}]')`);
    await checked(`(()=>{const control=document.querySelector(${js(INSPECT)}).querySelector('[name=${name}]');for(const option of control.options)option.selected=${js(values)}.includes(option.value);control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const inspect = async (receipt, acceptedQuantity, rejectedQuantity, evidence, acceptedSerials, rejectedSerials) => {
    const before = await view(receipt); await ready(version(before.version));
    for (const [name, value] of Object.entries({ acceptedQuantity, rejectedQuantity, evidence, reason: 'Synthetic actual explicit inspection partition' })) await form.fillIn(INSPECT, name, value);
    if (acceptedSerials) { await many('acceptedSerials', acceptedSerials); await many('rejectedSerials', rejectedSerials); }
    await form.clickIn(INSPECT, 'Save catalog receipt inspection'); await ready(version(before.version + 1)); return view(receipt);
  };
  const approve = async (receipt, keyboard = false) => {
    const before = await view(receipt); await form.fillIn(APPROVE, 'reason', 'Synthetic approval of exact immutable QC revision');
    if (keyboard) {
      await checked(`document.querySelector(${js(APPROVE)}).querySelector('[name=reason]').focus()`);
      await call('Input.dispatchKeyEvent', { type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9 }); await call('Input.dispatchKeyEvent', { type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9 });
      assert.equal(await checked('document.activeElement.textContent'), 'Approve catalog receipt inspection'); assert.equal(await checked('getComputedStyle(document.activeElement).outlineStyle'), 'solid');
      await call('Input.dispatchKeyEvent', { type:'char',text:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13 });
    } else await form.clickIn(APPROVE, 'Approve catalog receipt inspection');
    await ready(version(before.version + 1)); return view(receipt);
  };
  const hold = async (receipt, note) => { const current = await view(receipt); return (await api(`/warehouse/receipts/${receipt._id}/holds`, { expectedReceiptVersion: current.receiptVersion, reasonCode: 'QC_SUSPECT', reasonNote: note }, { 'Idempotency-Key': randomUUID() })).hold; };
  const release = holdRow => api(`/warehouse/holds/${holdRow.id}/release`, { expectedVersion: holdRow.version, reasonCode: 'INSPECTION_PASSED', reasonNote: 'Synthetic authoritative hold cleared' }, { 'Idempotency-Key': randomUUID() });
  const layout = async label => {
    for (const width of [1440, 768, 375, 360]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 }); await ready(`innerWidth===${width}`);
      await checked('(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelector("#catalog-receipt-qc").scrollIntoView({block:"start",behavior:"instant"})})()');
      assert.equal(await checked('document.documentElement.scrollWidth>innerWidth'), false);
      assert.deepEqual(await checked(`[...document.querySelectorAll('#catalog-receipt a,#catalog-receipt button,#catalog-receipt input,#catalog-receipt select,#catalog-receipt textarea,#catalog-receipt summary')].filter(element=>element.getBoundingClientRect().height&&getComputedStyle(element).position!=='absolute'&&element.getBoundingClientRect().height<43.9).map(element=>element.textContent)`), []);
      await screenshot(`wave4qc-${label}-${width}`);
      await checked('document.querySelector("#catalog-typed-stock").scrollIntoView({block:"start",behavior:"instant"})');
      await screenshot(`wave4qc-${label}-${width}-ledger`);
    }
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  };

  await navigate(lot); let current = await inspect(lot, '1.75', '0.75', 'Synthetic actual LOT dimensional inspection');
  const first = await api(`${base(lot)}/inspections/1`); current = await inspect(lot, '1.75', '0.75', 'Synthetic revised complete inspection evidence');
  assert.equal(current.currentRevision, 2); assert.deepEqual(await api(`${base(lot)}/inspections/1`), first); assert.equal(current.stock, null);
  await click('Inspect catalog inspection revision 1'); await ready('document.body.innerText.includes("Immutable recorded inspection")&&document.body.innerText.includes("Synthetic actual LOT dimensional inspection")');
  check('QC native exact fractional LOT inspection revisions retain immutable physical origin and prior evidence without creating approved or available stock');
  const held = await hold(lot, 'Synthetic hold after historical inspection'); await navigate(lot);
  assert.match(await form.disabledReason(APPROVE, 'Approve catalog receipt inspection'), /SOURCE_HELD/); assert.equal((await view(lot)).canRecord, true);
  await release(held); await navigate(lot); current = await approve(lot, true);
  assert.equal(current.status, 'APPROVED'); assert.equal(current.stock.acceptedPendingQuantity, '1.75'); assert.equal(current.stock.physicalAvailableQuantity, '0'); assert.equal(current.stock.rejectedQuantity, '0.75'); assert.equal(current.canAllocate, false);
  check('QC native approval is blocked by actual source hold, recovers after authoritative release, and keyboard approval binds the exact revision as pending accepted stock');
  await form.fillIn(PUTAWAY, 'locationId', location._id); await form.fillIn(PUTAWAY, 'reason', 'Synthetic accepted-only putaway to qualified company location');
  let committed, retained;
  await loseResponse(`*catalog-disposition/receipts/${lot._id}/putaway`, () => form.clickIn(PUTAWAY, 'Put away accepted catalog stock'), async ({ command, receipt }) => {
    retained = command; assert.equal(command.expectedLocationVersion, location.version); assert.equal(command.locationId, location._id); assert.equal(Object.hasOwn(command, 'quantity'), false);
    assert.equal(receipt.data.stock.physicalAvailableQuantity, '1.75'); assert.equal(receipt.data.receipt.availableQuantity, '0'); assert.equal(await db.collection('catalogStockMovements').countDocuments({ receiptId: lot._id }), 1); committed = await stock();
  });
  await ready('document.body.innerText.includes("Retry same catalog command")');
  assert.equal(await checked(`[...document.querySelectorAll('#catalog-receipt form input,#catalog-receipt form select,#catalog-receipt form textarea')].every(control=>control.disabled||control.closest('fieldset:disabled'))`), true);
  assert.equal(await checked(`(()=>{const buttons=[...document.querySelectorAll('#catalog-receipt button')];return ['Refresh controlled catalog receipt','Reload holds','Inspect catalog inspection revision 1','Inspect catalog inspection revision 2'].every(label=>{const button=buttons.find(candidate=>candidate.textContent.trim()===label);return button&&(button.disabled||button.closest('fieldset:disabled'));});})()`), true);
  await click('Retry same catalog command'); await ready(version(current.version + 1)); assert.deepEqual(await stock(), committed); current = await view(lot);
  assert.equal(current.status, 'STORED'); assert.equal(current.stock.physicalAvailableQuantity, '1.75'); assert.equal(current.stock.eligibleQuantity, '1.75'); assert.equal(current.stock.locationSnapshot._id, location._id); assert.equal(current.stock.locationSnapshot.binSnapshot._id, bin._id); assert.equal(current.canExecute, false);
  await layout('lot-stock');
  check('QC native whole accepted putaway uses real qualified location/bin versions; response-loss retry preserves one stock movement, exact ledger quantity and locked source/history/hold controls');

  await navigate(serial); assert.equal(await checked(`document.querySelector('[name=acceptedSerials]').selectedOptions.length`), 0); assert.equal(await checked(`document.querySelector('[name=rejectedSerials]').selectedOptions.length`), 0);
  await inspect(serial, '2', '1', 'Synthetic actual explicit supplied serial inspection', ['SYNTH_QC_A', 'SYNTH_QC_B'], ['SYNTH_QC_C']); await approve(serial);
  current = await view(serial); await form.fillIn(PUTAWAY, 'locationId', location._id); await form.fillIn(PUTAWAY, 'reason', 'Synthetic explicit accepted identity putaway'); await form.clickIn(PUTAWAY, 'Put away accepted catalog stock'); await ready(version(current.version + 1)); current = await view(serial);
  assert.deepEqual(current.units.filter(unit => unit.status === 'AVAILABLE').map(unit => unit.serial).sort(), ['SYNTH_QC_A', 'SYNTH_QC_B']); assert.deepEqual(current.units.filter(unit => unit.status === 'REJECTED_QUARANTINE').map(unit => unit.serial), ['SYNTH_QC_C']); assert.equal(current.stock.physicalAvailableQuantity, '2'); assert.equal(current.stock.rejectedQuantity, '1');
  await layout('serial-stock');
  check('QC native SERIAL partition selects actual incoming IDs explicitly; accepted identities become typed available once while rejected identity remains quarantine and shared registry is unchanged');
  await navigate(rejected); await inspect(rejected, '0', '1', 'Synthetic all rejected receipt inspection'); current = await approve(rejected);
  assert.equal(current.receipt.status, 'CATALOG_REJECTED'); assert.equal(current.stock.physicalAvailableQuantity, '0'); assert.equal(current.canPutaway, false); assert.equal(await db.collection('catalogStockMovements').countDocuments({ receiptId: rejected._id }), 0); assert.match(await form.disabledReason(PUTAWAY, 'Put away accepted catalog stock'), /ALL_REJECTED/);
  check('QC native all-rejected approval is terminal quarantine with no putaway, zero available stock and no procurement entitlement reversal');

  const balanceNames = ['catalogStockBalances', 'catalogStockUnits', 'catalogStockMovements'], beforeEligibility = await snapshot(balanceNames), laterHold = await hold(lot, 'Synthetic hold on already stored typed stock');
  await navigate(lot); current = await view(lot); assert.equal(current.stock.physicalAvailableQuantity, '1.75'); assert.equal(current.stock.eligibleQuantity, '0'); assert.ok(current.blockers.includes('SOURCE_HELD')); assert.deepEqual(await snapshot(balanceNames), beforeEligibility);
  await release(laterHold); assert.equal((await view(lot)).stock.eligibleQuantity, '1.75');
  await api(`/inventory-master/locations/${location._id}/deactivate`, common(location.version)); await navigate(lot); current = await view(lot);
  assert.ok(current.blockers.includes('LOCATION_CHANGED')); assert.equal(current.stock.physicalAvailableQuantity, '1.75'); assert.equal(current.stock.eligibleQuantity, '0'); assert.deepEqual(await snapshot(balanceNames), beforeEligibility);
  check('QC late hold and location withdrawal reduce live eligibility to zero without rewriting stored accepted quantity, rejected disposition or original qualified putaway evidence');

  const credential = await db.collection('credentials').findOne({ username:'alpha.owner' }), member = await db.collection('memberships').findOne({ userId:credential._id }), beforeRole = await stock();
  await db.collection('memberships').updateOne({ _id:member._id }, { $set:{ roles:[{ role:'catalogQCReader',plantIds:member.plantIds }] } });
  try {
    await call('Page.reload'); await ready(`(()=>{const button=document.querySelector(${js(INSPECT)})?.querySelector('button.pf-primary');return !!button&&!!document.getElementById(button.getAttribute('aria-describedby'))?.textContent.includes('catalog.qc.record');})()`); assert.match(await form.disabledReason(INSPECT, 'Save catalog receipt inspection'), /catalog.qc.record/); assert.match(await form.disabledReason(APPROVE, 'Approve catalog receipt inspection'), /catalog.qc.approve/); assert.match(await form.disabledReason(PUTAWAY, 'Put away accepted catalog stock'), /catalog.putaway|master.read/);
    assert.equal((await send(`/catalog-procurement/receipts/${lot._id}`)).status, 403); assert.equal((await send(`${base(lot)}/putaway`, retained)).status, 403); assert.deepEqual(await stock(), beforeRole);
  } finally { await db.collection('memberships').updateOne({ _id:member._id }, { $set:{ roles:member.roles } }); }
  await call('Page.reload'); await ready('document.querySelector("#catalog-receipt-qc")');
  const beforeDenied = await stock(), denied = await send(`/warehouse/receipts/${lot._id}/release`, { expectedVersion:current.receiptVersion, reason:'Synthetic denied legacy stock release',idempotencyKey:randomUUID() }); assert.equal(denied.error.code, 'CATALOG_RECEIPT_UNSUPPORTED'); assert.deepEqual(await stock(), beforeDenied);
  const reconciliation = await api(`/warehouse/receipts/${lot._id}/reconciliation`); assert.equal(reconciliation.matches, true); assert.equal(reconciliation.cached.availableQuantity, '0'); assert.equal(reconciliation.catalog.stockIsSeparate, true);
  await call('Page.navigate', { url: `${process.env.PORTFOLIO_WEB_ORIGIN}/portfolio/warehouse/receipts/${lot._id}` }); await ready('document.body.innerText.includes("Legacy operations blocked")&&document.body.innerText.includes("CATALOG_STORED")');
  assert.equal(await checked(`[...document.querySelectorAll('form h2')].some(heading=>/Record QC release|Put away|Reserve for sales order|Transfer stock|Record count/.test(heading.textContent))`), false);
  await navigate(lot);
  assert.deepEqual(await snapshot(immutableNames), immutable); assert.deepEqual(await snapshot(forbiddenNames), beforeForbidden);
  check('QC-only reader native deep link needs no procurement grants; revoked exact putaway replay and all legacy stock use stay denied while source identity, zero warehouse counters and downstream entitlements remain unchanged');
}
