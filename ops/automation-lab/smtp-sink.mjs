import net from 'node:net';
import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const localAddress = value => /^[^<>\s@]+@iems\.local$/i.test(value);

export function createSmtpSink({ smtpPort = 2527, httpPort = 8027, host = '127.0.0.1', token = process.env.IEMS_AUTOMATION_SINK_TOKEN, dataFile = process.env.IEMS_AUTOMATION_SINK_FILE } = {}) {
  if (host !== '127.0.0.1') throw new Error('SMTP lab must bind to loopback');
  const emails = dataFile && existsSync(dataFile) ? readFileSync(dataFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  if (dataFile) mkdirSync(dirname(dataFile), { recursive: true });
  const sockets = new Set();
  const authorized = req => {
    const given = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token || ''}`);
    return Boolean(token) && given.length === expected.length && timingSafeEqual(given, expected);
  };

  function accept(raw, envelope) {
    const boundary = raw.indexOf('\r\n\r\n');
    if (boundary < 0) throw new Error('Message headers required');
    const headers = {};
    let key;
    for (const line of raw.slice(0, boundary).split('\r\n')) {
      if (/^\s/.test(line) && key) headers[key] += ` ${line.trim()}`;
      else {
        const colon = line.indexOf(':');
        if (colon < 1) throw new Error('Malformed header');
        key = line.slice(0, colon).toLowerCase();
        headers[key] = line.slice(colon + 1).trim();
      }
    }
    const email = {
      id: randomUUID(), receivedAt: new Date().toISOString(),
      envelopeFrom: envelope.from, envelopeTo: [...envelope.to],
      from: headers.from || envelope.from, to: headers.to || envelope.to.join(', '),
      subject: headers.subject || '(No subject)', headers,
      body: raw.slice(boundary + 4).replace(/^\.\./gm, '.'), raw,
      receiptStatus: 'Accepted by local mail sink'
    };
    // Persist SMTP DATA before returning a transport acceptance response.
    if (dataFile) {
      const fd = openSync(dataFile, 'a');
      try { appendFileSync(fd, `${JSON.stringify(email)}\n`); fsyncSync(fd); }
      finally { closeSync(fd); }
    }
    emails.push(email);
    return email;
  }

  const smtpServer = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(15000, () => socket.destroy());
    let buffer = '', data = false, envelope = { from: '', to: [] };
    socket.write('220 IEMS local SMTP sink ready\r\n');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > 1024 * 1024) { socket.end('552 Message exceeds 1 MiB\r\n'); return; }
      while (true) {
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          const raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          data = false;
          try {
            const email = accept(raw, envelope);
            socket.write(`250 2.0.0 OK: queued as ${email.id}\r\n`);
          } catch { socket.write('451 4.3.0 Message could not be persisted\r\n'); }
          envelope = { from: '', to: [] };
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^(EHLO|HELO)\b/i.test(line)) socket.write('250-IEMS local sink\r\n250 SIZE 1048576\r\n');
        else if (/^MAIL FROM:/i.test(line)) {
          const from = /^MAIL FROM:\s*<([^>]+)>\s*$/i.exec(line)?.[1];
          if (!from || !localAddress(from)) socket.write('553 Synthetic @iems.local sender required\r\n');
          else { envelope = { from, to: [] }; socket.write('250 2.1.0 Sender OK\r\n'); }
        } else if (/^RCPT TO:/i.test(line)) {
          const to = /^RCPT TO:\s*<([^>]+)>\s*$/i.exec(line)?.[1];
          if (!envelope.from || !to || !localAddress(to)) socket.write('553 Synthetic @iems.local recipient required\r\n');
          else { envelope.to.push(to); socket.write('250 2.1.5 Recipient OK\r\n'); }
        } else if (/^DATA$/i.test(line)) {
          if (!envelope.to.length) socket.write('503 MAIL and RCPT required\r\n');
          else { data = true; socket.write('354 End with <CRLF>.<CRLF>\r\n'); }
        } else if (/^QUIT$/i.test(line)) { socket.end('221 Bye\r\n'); return; }
        else if (/^RSET$/i.test(line)) { envelope = { from: '', to: [] }; socket.write('250 Reset\r\n'); }
        else if (/^NOOP$/i.test(line)) socket.write('250 OK\r\n');
        else socket.write('500 Unsupported command\r\n');
      }
    });
  });

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    if (req.method === 'GET' && url.pathname === '/health') return reply(200, { status: 'HEALTHY', sink: 'SMTP', durable: Boolean(dataFile) });
    if (!authorized(req)) return reply(401, { error: 'PRIVATE_INSPECTOR', message: 'Use the scoped IEMS inspector API' });
    if (req.method !== 'GET') return reply(405, { error: 'SMTP_ONLY', message: 'Only SMTP DATA can create a receipt' });
    if (url.pathname === '/api/emails') {
      const messageId = url.searchParams.get('messageId');
      return reply(200, { data: emails.filter(email => !messageId || email.headers['message-id'] === messageId) });
    }
    if (url.pathname.startsWith('/api/emails/')) {
      const email = emails.find(item => item.id === url.pathname.slice('/api/emails/'.length));
      return email ? reply(200, { data: email }) : reply(404, { error: 'EMAIL_NOT_FOUND' });
    }
    return reply(404, { error: 'NOT_FOUND' });
  });

  return {
    emails,
    async start() {
      await Promise.all([[smtpServer, smtpPort], [httpServer, httpPort]].map(([server, port]) => new Promise((resolve, reject) => {
        server.once('error', reject); server.listen(port, host, resolve);
      })));
      return { smtpPort: smtpServer.address().port, httpPort: httpServer.address().port };
    },
    async stop() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([smtpServer, httpServer].map(server => new Promise(resolve => server.close(resolve))));
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.IEMS_AUTOMATION_SINK_TOKEN || !process.env.IEMS_AUTOMATION_SINK_FILE) throw new Error('Set private sink token and durable sink file outside Git');
  const sink = createSmtpSink({ smtpPort: Number(process.env.IEMS_AUTOMATION_SMTP_PORT || 2527), httpPort: Number(process.env.SMTP_HTTP_PORT || 8027) });
  sink.start().then(ports => console.log(JSON.stringify({ service: 'iems-smtp-sink', host: '127.0.0.1', ...ports }))).catch(error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => sink.stop().then(() => { process.exitCode = 0; }));
}
