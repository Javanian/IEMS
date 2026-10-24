import test from 'node:test';
import assert from 'node:assert/strict';
import { engineeringContent, engineeringDraft, engineeringTransition, engineeringRelease } from '../src/features/portfolio/engineering.mjs';

test('engineering draft binds persisted SO version/line/UOM and preserves exact BOM strings', () => {
  const order = {_id:'so', version:3, snapshot:{lines:[{uom:'EA'}]}};
  const values = {lineIndex:'0', code0:' MIX ', instruction0:' Mix material ', receiptId0:'receipt', quantityPerUnit0:'0.250000'};
  const content = engineeringContent(values,1,1,[{_id:'receipt',uom:'KG'}]);
  assert.deepEqual(content,{operations:[{code:' MIX ',instruction:' Mix material '}],materials:[{receiptId:'receipt',quantityPerUnit:'0.250000',uom:'KG'}]});
  assert.deepEqual(engineeringDraft(order,values,content,'draft-key'),{expectedVersion:1,idempotencyKey:'draft-key',salesOrderId:'so',salesOrderVersion:3,lineIndex:0,uom:'EA',...content});
});
test('engineering transitions and WO release pin exact public versions and revision without caller overrides', () => {
  const head={_id:'package',version:7,currentRevision:3};
  assert.deepEqual(engineeringTransition(head,'release-key'),{expectedVersion:7,idempotencyKey:'release-key',revision:3});
  assert.deepEqual(engineeringTransition(head,'revoke-key','Superseded'),{expectedVersion:7,idempotencyKey:'revoke-key',revision:3,reason:'Superseded'});
  assert.deepEqual(engineeringRelease({_id:'wo',version:2},head,'wo-release'),{expectedVersion:2,idempotencyKey:'wo-release',engineeringId:'package',engineeringVersion:7,revision:3});
});
