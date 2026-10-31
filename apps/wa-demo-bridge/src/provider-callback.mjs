import { createHmac, timingSafeEqual } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9_.:-]{1,160}$/;
const reject = () => { throw Object.assign(new Error('INVALID_PROVIDER_CALLBACK'), { status: 401 }); };

// Authenticate exact bytes before parsing; callers must durably deduplicate eventId.
export function createProviderCallbackVerifier({ tenantId, accountId, secret, now = Date.now }) {
  if (!uuid.test(tenantId ?? '') || typeof accountId !== 'string' || !identifier.test(accountId)
    || !Buffer.isBuffer(secret) || secret.length < 32 || typeof now !== 'function') throw new Error('INVALID_CALLBACK_CONFIGURATION');
  const key = Buffer.from(secret);
  return function verify({ rawBody, timestamp, signature }) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > 4096
      || typeof timestamp !== 'string' || !/^[0-9]{13}$/.test(timestamp)
      || typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) reject();
    const time = now();
    if (!Number.isSafeInteger(time) || Math.abs(time - Number(timestamp)) > 300_000) reject();
    const expected = createHmac('sha256', key).update(timestamp).update('.').update(rawBody).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) reject();
    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { reject(); }
    const fields = ['version', 'tenantId', 'accountId', 'eventId', 'deliveryId', 'providerMessageId', 'status'];
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== fields.length
      || fields.some(field => !Object.hasOwn(body, field)) || body.version !== 1
      || body.tenantId !== tenantId || body.accountId !== accountId
      || !uuid.test(body.deliveryId ?? '')
      || typeof body.eventId !== 'string' || !identifier.test(body.eventId)
      || typeof body.providerMessageId !== 'string' || !identifier.test(body.providerMessageId)
      || !['ACCEPTED', 'DELIVERED', 'FAILED'].includes(body.status)) reject();
    return Object.freeze({ ...body });
  };
}
