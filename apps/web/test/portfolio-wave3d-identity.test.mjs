import test from 'node:test';
import assert from 'node:assert/strict';
import { persistedIdentity } from '../src/features/portfolio/customer-service.mjs';
test('CS identity uses persisted IDs across list order, pagination and history reload', () => {
 const rows=[{_id:'persisted-a'},{ticketId:'ticket-b',_id:'persisted-b'}];
 assert.deepEqual(rows.map(r=>persistedIdentity(r,'ticket')),['ticket:persisted-a','ticket:ticket-b']);
 assert.deepEqual(rows.toReversed().map(r=>persistedIdentity(r,'ticket')),['ticket:ticket-b','ticket:persisted-a']);
 assert.equal(persistedIdentity({eventId:'event-a'},'history'),'history:event-a');
 assert.equal(persistedIdentity({_id:'event-b'},'history'),'history:event-b');
 assert.notEqual(persistedIdentity({_id:'same'},'ticket'),persistedIdentity({_id:'same'},'conversation'));
});
