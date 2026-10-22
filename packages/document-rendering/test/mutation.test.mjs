import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshot } from '../src/index.mjs';
const scope={tenantId:'t',legalEntityId:'e',plantId:'p'};
test('shipment rejects noncanonical UOM instead of printing an ambiguous unit',()=>{
 assert.throws(()=>createSnapshot('shipment',scope,{...scope,_id:'s',version:1,salesOrderId:'so',reference:'dispatch',lineIndex:0,quantity:'1',uom:'kg'}),/INVALID_UOM/);
});
