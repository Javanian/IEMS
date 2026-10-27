import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Creates business data only through the same authenticated routes as the demo UI.
export async function complaintThroughApi(h) {
  const request = async (path, body, status = 200) => {
    const response = await h.send(path, { body, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(response.status, status, `${path}: ${JSON.stringify(response)}`);
    return response.data;
  };
  const account = await request('/crm/accounts', { name: 'Synthetic automation acceptance customer' }, 201);
  const contact = await request(`/crm/accounts/${account._id}/contacts`, { name: 'Synthetic contact', email: 'synthetic@iems.local' }, 201);
  const { binding } = await request('/cs/bindings', { accountId: account._id, contactId: contact._id, channel: 'SIMULATED', address: `+62000${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}` }, 201);
  let confirmed;
  for (const text of ['IEMS COMPLAINT', 'IEMS COMPLAINT GENERAL', 'IEMS COMPLAINT CATEGORY OTHER', 'IEMS COMPLAINT DESCRIBE Synthetic automation acceptance complaint', 'IEMS COMPLAINT CONFIRM']) {
    confirmed = await request('/cs/simulator/inbound', { bindingId: binding.bindingId, inboundKey: randomUUID(), text });
    assert.equal(confirmed.error, undefined, JSON.stringify(confirmed));
  }
  assert.ok(confirmed.ticket?.ticketId);
  return { account, contact, binding, ticket: confirmed.ticket, conversationId: confirmed.conversationId, request };
}

export async function resolveThroughApi(h, ticketId) {
  let ticket = (await h.send(`/cs/tickets/${ticketId}`)).data;
  const stages = ticket.stage === 'NEW' || ticket.stage === 'TRIAGED' ? ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED'] : ['IN_PROGRESS', 'RESOLVED'];
  for (const toStage of stages) {
    const result = await h.send(`/cs/tickets/${ticketId}/stage`, { body: { expectedVersion: ticket.version, toStage, reason: 'Synthetic issue handled by operator', commandKey: randomUUID(), ...(toStage === 'ASSIGNED' ? { assigneeId: h.seeded[0].userId } : {}) } });
    assert.equal(result.status, 200, JSON.stringify(result)); ticket = result.data;
  }
  return ticket;
}
