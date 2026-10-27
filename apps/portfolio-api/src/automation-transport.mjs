import net from 'node:net';
import { createHash } from 'node:crypto';

export const hashText = value => createHash('sha256').update(value).digest('hex');
export function localUrl(value, fallback) {
  const url = new URL(value || fallback);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('AUTOMATION_LOOPBACK_REQUIRED');
  return url.origin;
}

// Submission becomes uncertain as soon as DATA is written, even if its 250 is lost.
export async function submitLocalMail(delivery, options = {}) {
  if ([delivery.recipient, delivery.subject, delivery.messageId, delivery._id, delivery.tenantId, delivery.plantId, delivery.contentHash].some(value => typeof value !== 'string' || /[\r\n]/.test(value))) throw new Error('INVALID_MAIL_HEADERS');
  const port = Number(options.smtpPort || process.env.IEMS_AUTOMATION_SMTP_PORT || 2527);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_SMTP_PORT');
  const headers = [
    'From: automation@iems.local', `To: ${delivery.recipient}`, `Subject: ${delivery.subject}`,
    `Message-ID: ${delivery.messageId}`, `X-IEMS-Delivery-ID: ${delivery._id}`,
    `X-IEMS-Tenant-ID: ${delivery.tenantId}`, `X-IEMS-Plant-ID: ${delivery.plantId}`,
    `X-IEMS-Content-Hash: ${delivery.contentHash}`, 'Content-Type: text/plain; charset=utf-8'
  ];
  const body = delivery.body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let buffer = '', step = 0, submitted = false, finished = false;
    const done = (error, result) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) { error.submitted = submitted; reject(error); } else resolve(result);
    };
    socket.setTimeout(options.timeoutMs || 5000, () => done(new Error('SMTP_TIMEOUT')));
    socket.on('error', () => done(new Error('SMTP_UNAVAILABLE')));
    socket.on('close', () => { if (!finished) done(new Error('SMTP_CONNECTION_CLOSED')); });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!/^\d{3} /.test(line)) continue;
        const code = Number(line.slice(0, 3));
        const expected = [220, 250, 250, 250, 354, 250][step];
        if (code !== expected) return done(new Error('SMTP_REJECTED'));
        if (step === 0) socket.write('EHLO iems.local\r\n');
        if (step === 1) socket.write('MAIL FROM:<automation@iems.local>\r\n');
        if (step === 2) socket.write(`RCPT TO:<${delivery.recipient}>\r\n`);
        if (step === 3) socket.write('DATA\r\n');
        if (step === 4) { submitted = true; socket.write(`${headers.join('\r\n')}\r\n\r\n${body}\r\n.\r\n`); }
        if (step === 5) return done(null, { submitted: true });
        step += 1;
      }
    });
  });
}

export async function verifiedSinkReceipt(delivery, options = {}) {
  const base = localUrl(options.sinkUrl || process.env.IEMS_AUTOMATION_SINK_URL, 'http://127.0.0.1:8027');
  const token = options.sinkToken || process.env.IEMS_AUTOMATION_SINK_TOKEN;
  if (!token) return null;
  const response = await fetch(`${base}/api/emails?messageId=${encodeURIComponent(delivery.messageId)}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000)
  });
  if (!response.ok) return null;
  const data = (await response.json()).data;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows.find(row => {
    const h = row.headers || {};
    const to = row.envelopeTo || row.envelope?.to || [];
    return typeof row.id === 'string' && row.receiptStatus === 'Accepted by local mail sink'
      && h['message-id'] === delivery.messageId && h['x-iems-delivery-id'] === delivery._id
      && h['x-iems-tenant-id'] === delivery.tenantId && h['x-iems-plant-id'] === delivery.plantId
      && h['x-iems-content-hash'] === delivery.contentHash && to.length === 1 && to[0] === delivery.recipient
      && row.subject === delivery.subject && hashText(String(row.body).replace(/\r\n/g, '\n')) === delivery.contentHash;
  }) || null;
}
