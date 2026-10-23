import test from 'node:test';
import assert from 'node:assert/strict';
import { shipmentCommand, invoiceCommand, paymentCommand, validQuantity, deliveryLabel } from '../src/features/portfolio/fulfillment.mjs';
test('shipment captures the real order version and preserves exact source quantities', () => {
 const order={_id:'so',version:7,snapshot:{lines:[{uom:'EA'}]}};
 assert.deepEqual(shipmentCommand(order,{lineIndex:'0',sourceType:'WORK_ORDER',sourceId:'wo',quantity:'0.250000',reference:'Internal dispatch'},'owned-key'),{salesOrderId:'so',expectedVersion:7,lineIndex:0,uom:'EA',reference:'Internal dispatch',sources:[{sourceType:'WORK_ORDER',sourceId:'wo',quantity:'0.250000'}],idempotencyKey:'owned-key'});
});
test('invoice and payment preserve strings and bind current versions',()=>{
 assert.deepEqual(invoiceCommand({_id:'so',version:8},{shipmentId:'shipment',quantity:'0.250000'},'owned-key'),{salesOrderId:'so',expectedVersion:8,lines:[{shipmentId:'shipment',quantity:'0.250000'}],idempotencyKey:'owned-key'});
 assert.deepEqual(paymentCommand({accountId:'customer',currency:'KWD',_id:'invoice',version:2},{amount:'12.123',reference:'Internal receipt'},'owned-key'),{accountId:'customer',amount:'12.123',currency:'KWD',reference:'Internal receipt',allocations:[{invoiceId:'invoice',expectedVersion:2,amount:'12.123'}],idempotencyKey:'owned-key'});
});
test('decimal validation rejects coercion and delivery labels never imply preview sent',()=>{
 for(const q of ['0','01.1','1e3',1,'0.0000001']) assert.equal(validQuantity(q),false);
 assert.equal(validQuantity('0.250000'),true);
 assert.match(deliveryLabel('PREVIEWED'),/Preview only/);
 assert.match(deliveryLabel('UNKNOWN'),/Unknown/);
});
