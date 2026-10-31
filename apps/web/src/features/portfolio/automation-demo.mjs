// Creates a synthetic complaint using the same CRM, binding and inbound APIs as the operator UI.
export async function createSyntheticComplaint(request, occurrence = crypto.randomUUID()) {
  const post = async (path, body, key) => (await request(path, { body, ...(key ? { headers: { 'Idempotency-Key': key } } : {}) })).data;
  const account = await post('/api/crm/accounts', { name: `Synthetic automation customer ${occurrence.slice(0, 8)}` });
  const contact = await post(`/api/crm/accounts/${account._id}/contacts`, { name: 'Synthetic local customer', email: 'customer@iems.local' });
  const digits = [...occurrence.replaceAll('-', '').slice(0, 9)].map(value => parseInt(value, 16) % 10).join('');
  const result = await post('/api/cs/bindings', { accountId: account._id, contactId: contact._id, channel: 'SIMULATED', address: `+62000${digits}` }, `demo-binding-${occurrence}`);
  const binding = result.binding;
  let inbound;
  for (const [index, text] of ['IEMS COMPLAINT', 'IEMS COMPLAINT GENERAL', 'IEMS COMPLAINT CATEGORY QUALITY', 'IEMS COMPLAINT DESCRIBE Synthetic packaging damage for the local automation demo', 'IEMS COMPLAINT CONFIRM'].entries()) {
    inbound = await post('/api/cs/simulator/inbound', { bindingId: binding.bindingId, inboundKey: `demo-inbound-${occurrence}-${index}`, text });
    if (inbound.error) throw new Error(`Complaint was not confirmed: ${inbound.error}`);
  }
  if (!inbound.ticket?.ticketId) throw new Error('The simulator did not return a persisted complaint ticket');
  return { ...inbound.ticket, bindingId: binding.bindingId, bindingVersion: binding.version, conversationId: inbound.conversationId, occurrence };
}
