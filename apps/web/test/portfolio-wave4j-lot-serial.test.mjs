import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptCommand } from '../src/features/portfolio/warehouse.mjs';
import { planCommand, recordCommand, qcCommand, manufacturingHint } from '../src/features/portfolio/manufacturing.mjs';
import { shipmentCommand } from '../src/features/portfolio/fulfillment.mjs';

const order = { _id:'so', version:7, snapshot:{ lines:[{ uom:'EA' }] } };
const workOrder = { version:3, serialized:true, quantity:'6', uom:'EA', routing:{ operations:[{ code:'MACHINE' }, { code:'FINISH' }] }, records:[{ goodQuantity:'6' }] };

test('receipt lot and heat preserve exact source identity and omit absent legacy metadata', () => {
  const po = { _id:'po', vendorId:'vendor', version:4 };
  const values = { lineIndex:'0', quantity:'6.000000', uom:'EA', serials:'', lotNumber:'LOT/2026.01', heatNumber:'HEAT-A_2' };
  const traced = receiptCommand(po, values, 'receipt-key');
  assert.equal(traced.lotNumber, 'LOT/2026.01');
  assert.equal(traced.heatNumber, 'HEAT-A_2');
  assert.equal(traced.quantity, '6.000000');
  const legacy = receiptCommand(po, { ...values, lotNumber:'', heatNumber:'' }, 'legacy-key');
  assert.equal(Object.hasOwn(legacy, 'lotNumber'), false);
  assert.equal(Object.hasOwn(legacy, 'heatNumber'), false);
  assert.equal(receiptCommand(po, { ...values, heatNumber:'' }, 'incomplete-key').lotNumber, values.lotNumber);
});

test('serialized plan opts in once without changing quantity strings or legacy payloads', () => {
  const values = { lineIndex:'0', quantities:'6.000000\n4', serialized:'true' };
  const command = planCommand(order, values, 'plan-key');
  values.serialized = 'false';
  assert.equal(command.serialized, true);
  assert.deepEqual(command.quantities, ['6.000000', '4']);
  assert.equal(command.expectedVersion, 7);
  assert.equal(Object.hasOwn(planCommand(order, values, 'legacy-key'), 'serialized'), false);
});

test('serial registration is confined to the serialized final operation, including zero output', () => {
  const values = { goodQuantity:'2.000000', scrapQuantity:'4', evidence:'Inspected', outputSerials:'UNIT-A\nUNIT_B' };
  assert.deepEqual(recordCommand(workOrder, values, 'record-key').outputSerials, ['UNIT-A', 'UNIT_B']);
  assert.equal(Object.hasOwn(recordCommand({ ...workOrder, records:[] }, values, 'first-key'), 'outputSerials'), false);
  assert.equal(Object.hasOwn(recordCommand({ ...workOrder, serialized:false }, values, 'legacy-key'), 'outputSerials'), false);
  assert.deepEqual(recordCommand(workOrder, { ...values, goodQuantity:'0', outputSerials:'' }, 'zero-key').outputSerials, []);
});

test('QC binds exact serial classifications to the captured WO version; legacy QC omits them', () => {
  const values = { acceptedQuantity:'1', rejectedQuantity:'1', evidence:'Inspector', acceptedSerials:' UNIT-A ', rejectedSerials:'UNIT_B' };
  const command = qcCommand(workOrder, values, 'qc-key');
  values.acceptedSerials = 'CHANGED';
  assert.deepEqual(command.acceptedSerials, ['UNIT-A']);
  assert.deepEqual(command.rejectedSerials, ['UNIT_B']);
  assert.equal(command.expectedVersion, 3);
  assert.equal(Object.hasOwn(qcCommand({ ...workOrder, serialized:false }, values, 'legacy-key'), 'acceptedSerials'), false);
});

test('shipment captures selected identities for exact replay and keeps reservation and legacy formats', () => {
  const serials = ['UNIT-A', 'UNIT_B'];
  const values = { lineIndex:'0', sourceType:'WORK_ORDER', sourceId:'wo', quantity:'2.000000', reference:'Dispatch', serials };
  const command = shipmentCommand(order, values, 'shipment-key');
  serials.pop();
  assert.deepEqual(command.sources[0].serials, ['UNIT-A', 'UNIT_B']);
  assert.equal(command.sources[0].quantity, '2.000000');
  assert.equal(command.expectedVersion, 7);
  assert.equal(Object.hasOwn(shipmentCommand(order, { ...values, serials:undefined }, 'legacy-key').sources[0], 'serials'), false);
  assert.equal(Object.hasOwn(shipmentCommand(order, { ...values, sourceType:'RESERVATION' }, 'reservation-key').sources[0], 'serials'), false);
});

test('serial conflict hints explain actual server rejection codes', () => {
  assert.match(manufacturingHint({ code:'SERIAL_QUANTITY_CONFLICT' }), /counts/);
  assert.match(manufacturingHint({ code:'SERIAL_STATE_CONFLICT' }), /available to ship/);
  assert.match(manufacturingHint({ code:'SERIAL_SOURCE_CONFLICT' }), /work order/);
});
