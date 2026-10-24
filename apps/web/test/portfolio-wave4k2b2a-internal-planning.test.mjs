import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedItems, internalEngineeringCommand, internalPlanCommand, internalTransitionCommand, itemCommand, locationCommand, planningCapability, planningHint, planningPage, qualifiedLocations } from '../src/features/portfolio/internal-planning.mjs';

const item = (id = 'output') => ({ _id:id,version:4,status:'APPROVED',currentRevision:2,content:{ description:'Actual approved item',uom:'UN',kind:'MANUFACTURED' },contentHash:'item-hash',approval:{ revision:2,contentHash:'item-hash' },blockers:[] });
const location = () => ({ _id:'location',version:3,status:'QUALIFIED',qualification:{ qualifiedBy:'person' },blockers:[] });
const order = () => ({ version:8,engineering:{ currentRevision:3 } });

test('master eligibility uses current approval and hash, never a previous approved revision under a new draft', () => {
  const approved = item(), draft = { ...item('draft'),status:'DRAFT',currentRevision:3,approval:null }, stale = { ...item('stale'),currentRevision:3 }, wrongHash = { ...item('hash'),contentHash:'changed' }, blocked = { ...item('blocked'),blockers:['OWNER_MISMATCH'] }, purchased = { ...item('purchased'),content:{ ...item().content,kind:'PURCHASED' } };
  assert.deepEqual(approvedItems([approved,draft,stale,wrongHash,blocked,purchased],true),[approved]);
  assert.deepEqual(approvedItems([approved,purchased]),[approved,purchased]);
});
test('location eligibility requires actual qualified evidence and clear live blockers', () => {
  const qualified = location();
  assert.deepEqual(qualifiedLocations([qualified,{ ...qualified,_id:'draft',status:'DRAFT' },{ ...qualified,_id:'missing',qualification:null },{ ...qualified,_id:'changed',blockers:['LOCATION_CHANGED'] }]),[qualified]);
});
test('incomplete approval and blocker reads never become eligible source options', () => {
  assert.deepEqual(approvedItems([{ ...item(),approval:null },{ ...item(),blockers:undefined }]),[]);
  assert.deepEqual(qualifiedLocations([{ ...location(),blockers:undefined }]),[]);
});
test('item creation preserves explicit uppercase input and omits forged ownership and approval authority', () => {
  assert.deepEqual(itemCommand(null,{ code:'MixedCase',description:'Widget',uom:'UN',kind:'MANUFACTURED',reason:'Create actual item',ownerLegalEntityId:'forged',approval:{ revision:1 } },'create-key'),{ expectedVersion:1,reason:'Create actual item',idempotencyKey:'create-key',code:'MixedCase',description:'Widget',uom:'UN',kind:'MANUFACTURED' });
});
test('item revision omits immutable code; approval captures exact read revision and version', () => {
  const head = item(), values = { code:'FORGED',description:'Next revision',uom:'SET',kind:'PURCHASED',reason:'Reviewed next content',revision:99,expectedVersion:999 };
  assert.deepEqual(itemCommand(head,values,'revision-key'),{ expectedVersion:4,reason:values.reason,idempotencyKey:'revision-key',description:'Next revision',uom:'SET',kind:'PURCHASED' });
  const command = itemCommand(head,values,'approve-key','approve');head.version=9;head.currentRevision=7;
  assert.deepEqual(command,{ expectedVersion:4,reason:values.reason,idempotencyKey:'approve-key',revision:2 });
});
test('terminal master transitions never send reactivation or arbitrary source rebinding', () => {
  assert.deepEqual(itemCommand(item(),{ reason:'Terminal item retirement',reactivate:true,code:'NEW' },'deactivate-key','deactivate'),{ expectedVersion:4,reason:'Terminal item retirement',idempotencyKey:'deactivate-key' });
  assert.deepEqual(locationCommand(location(),{ reason:'Actual qualification evidence',binId:'forged',ownerLegalEntityId:'forged' },'qualify-key'),{ expectedVersion:3,reason:'Actual qualification evidence',idempotencyKey:'qualify-key' });
  assert.deepEqual(locationCommand(null,{ code:'COMPANY_BIN',binId:'actual-bin',reason:'Actual company destination' },'location-key'),{ expectedVersion:1,reason:'Actual company destination',idempotencyKey:'location-key',code:'COMPANY_BIN',binId:'actual-bin' });
});
test('internal plan captures exact current item/location versions without SO, owner, execution or stock authority', () => {
  const source = item(), destination = location(), values = { itemId:'output',locationId:'location',quantity:'3',reason:'Produce company component',itemRevision:99,expectedItemVersion:999,ownerLegalEntityId:'forged',salesOrderId:'forged',execution:'RELEASED' };
  const command = internalPlanCommand([source],[destination],values,'plan-key');source.version=10;source.currentRevision=6;destination.version=9;
  assert.deepEqual(command,{ expectedVersion:1,reason:values.reason,idempotencyKey:'plan-key',itemId:'output',itemRevision:2,expectedItemVersion:4,locationId:'location',expectedLocationVersion:3,quantity:'3' });
});
test('missing planning sources are not replaced by caller versions or fabricated defaults', () => {
  const body = internalPlanCommand([],[],{ itemId:'missing',locationId:'missing',quantity:'1',reason:'No fabricated authority',itemRevision:1,expectedItemVersion:1 },'missing-key');
  assert.equal(body.itemRevision,undefined);assert.equal(body.expectedItemVersion,undefined);assert.equal(body.expectedLocationVersion,undefined);
});
test('engineering requires explicit item identities and derives revision/UOM authority from read sources', () => {
  const material = item('material'), values = { code0:'CUT',instruction0:'Cut observed specification',materialItemId0:'material',quantityPerUnit0:'1.500000',reason:'Exact internal BOM demand',uom:'FORGED',lineId:'forged',sourceKind:'INVENTORY_ISSUE',receiptId:'forged',quantity:'90' };
  const command = internalEngineeringCommand(order(),[material],values,1,1,'engineering-key');material.version=99;material.content.uom='FORGED';
  assert.deepEqual(command,{ expectedVersion:8,reason:values.reason,idempotencyKey:'engineering-key',operations:[{ code:'CUT',instruction:'Cut observed specification' }],materials:[{ itemId:'material',itemRevision:2,expectedItemVersion:4,quantityPerUnit:'1.500000',uom:'UN' }] });
});
test('engineering approval and revocation bind exact read revision; cancellation has no stock reversal payload', () => {
  const state = order(), values = { reason:'Review exact current demand',revision:999,returnToStock:true };
  assert.deepEqual(internalTransitionCommand(state,values,'approve-key',true),{ expectedVersion:8,reason:values.reason,idempotencyKey:'approve-key',revision:3 });
  assert.deepEqual(internalTransitionCommand(state,values,'cancel-key'),{ expectedVersion:8,reason:values.reason,idempotencyKey:'cancel-key' });
});
test('master and internal capabilities never expand existing manufacturing or custody grants', () => {
  const prior = ['manufacturing.read','manufacturing.plan','engineering.release','installation.read','custody.claim'];
  for (const action of ['master.read','master.item.write','master.item.approve','master.item.deactivate','master.location.write','master.location.qualify','master.location.deactivate','internal.read','internal.plan','internal.engineering.write','internal.engineering.approve','internal.engineering.revoke','internal.cancel']) {
    assert.equal(planningCapability(action,prior).enabled,false);assert.equal(planningCapability(action,[action]).enabled,true);
  }
  assert.equal(planningCapability('internal.plan',undefined).enabled,false);
});
test('history cursors stay resource-scoped and encoded', () => {
  assert.equal(planningPage('/api/inventory-master/items/i/events','cursor&extra=1'),'/api/inventory-master/items/i/events?limit=25&cursor=cursor%26extra%3D1');
});
test('recovery hints preserve frozen history and distinguish planning demand from execution', () => {
  assert.match(planningHint({ code:'INTERNAL_DEPENDENCY_CHANGED' }),/Frozen history is retained/);
  assert.match(planningHint({ code:'VERSION_CONFLICT' }),/does not release execution or create stock/);
  assert.match(planningHint({ code:'IDEMPOTENCY_CONFLICT' }),/different captured command/);
  assert.equal(planningHint({ code:'UNKNOWN' }),null);
});
