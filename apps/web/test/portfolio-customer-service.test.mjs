import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStages, stageCommand, messageLabel, inboxPath } from '../src/features/portfolio/customer-service.mjs';

test('stage choices follow the domain transition table', () => {
  assert.deepEqual(nextStages('NEW'), ['TRIAGED', 'ASSIGNED']);
  assert.deepEqual(nextStages('IN_PROGRESS'), ['WAITING_FOR_CUSTOMER', 'RESOLVED']);
  assert.deepEqual(nextStages('UNKNOWN'), []);
});
test('assignment binds the signed-in agent and version; other stages omit assignee', () => {
  assert.deepEqual(stageCommand({ version: 3 }, { toStage: 'ASSIGNED', reason: 'Owner' }, 'agent', 'key-0001'), { expectedVersion: 3, toStage: 'ASSIGNED', reason: 'Owner', assigneeId: 'agent', commandKey: 'key-0001' });
  assert.deepEqual(stageCommand({ version: 4 }, { toStage: 'RESOLVED', reason: 'Replaced item' }, 'agent', 'key-0002'), { expectedVersion: 4, toStage: 'RESOLVED', reason: 'Replaced item', commandKey: 'key-0002' });
  assert.throws(() => stageCommand({ version: 1 }, { toStage: 'ASSIGNED', reason: 'x' }, null, 'key-0003'));
});
test('thread labels separate public customer messages and never claim preview delivery as sent', () => {
  assert.equal(messageLabel({ direction: 'INBOUND', origin: 'CUSTOMER', state: 'RECEIVED' }), 'Customer · Public');
  assert.equal(messageLabel({ direction: 'OUTBOUND', origin: 'OPERATOR', state: 'PREVIEWED' }), 'Agent · Public · Preview only (not sent)');
  assert.equal(messageLabel({ direction: 'OUTBOUND', origin: 'BOT', state: 'UNKNOWN' }), 'Bot · Public · Unknown (delivery unconfirmed)');
  assert.equal(messageLabel({ direction: 'OUTBOUND', origin: 'BOT', state: 'QUEUED' }), 'Bot · Public · Queued (not sent)');
});
test('inbox paths keep filter and opaque cursor encoded', () => {
  assert.equal(inboxPath('tickets', { stage: 'NEW', cursor: 'a/b' }), '/api/cs/tickets?limit=25&stage=NEW&cursor=a%2Fb');
  assert.equal(inboxPath('conversations', {}), '/api/cs/conversations?limit=25');
});
