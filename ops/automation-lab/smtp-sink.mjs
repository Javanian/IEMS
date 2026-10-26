import net from 'node:net';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export function createSmtpSink({ smtpPort = 1025, httpPort = 1080, host = '127.0.0.1' } = {}) {
  const emails = [];
  let smtpServer = null;
  let httpServer = null;

  function parseEmail(raw, envelope) {
    const headerEndIndex = raw.indexOf('\r\n\r\n');
    const headerPart = headerEndIndex !== -1 ? raw.slice(0, headerEndIndex) : raw;
    const bodyPart = headerEndIndex !== -1 ? raw.slice(headerEndIndex + 4) : '';

    const headers = {};
    const lines = headerPart.split('\r\n');
    let currentKey = null;

    for (const line of lines) {
      if (/^\s+/.test(line) && currentKey) {
        headers[currentKey] += ' ' + line.trim();
      } else {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          currentKey = line.slice(0, colonIdx).trim().toLowerCase();
          headers[currentKey] = line.slice(colonIdx + 1).trim();
        }
      }
    }

    return {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      envelopeFrom: envelope.from || '',
      envelopeTo: envelope.to || [],
      from: headers['from'] || envelope.from || '',
      to: headers['to'] || (envelope.to || []).join(', '),
      subject: headers['subject'] || '(No Subject)',
      headers,
      body: bodyPart.replace(/\r\n\.\r\n$/, '').trim(),
      raw,
      receiptStatus: 'Accepted by local mail sink'
    };
  }

  // RFC-5321 Minimal SMTP Server
  smtpServer = net.createServer(socket => {
    let state = 'INIT';
    let envelope = { from: '', to: [] };
    let dataBuffer = '';
    let incomingBuffer = '';

    socket.write('220 127.0.0.1 IEMS-Local-SMTP-Sink ready\r\n');

    socket.on('data', chunk => {
      incomingBuffer += chunk.toString('utf-8');

      while (true) {
        if (state === 'DATA') {
          const endIdx = incomingBuffer.indexOf('\r\n.\r\n');
          if (endIdx !== -1) {
            dataBuffer += incomingBuffer.slice(0, endIdx);
            incomingBuffer = incomingBuffer.slice(endIdx + 5);
            const email = parseEmail(dataBuffer, envelope);
            emails.push(email);
            state = 'COMMAND';
            envelope = { from: '', to: [] };
            dataBuffer = '';
            socket.write(`250 2.0.0 OK: queued as ${email.id}\r\n`);
          } else {
            dataBuffer += incomingBuffer;
            incomingBuffer = '';
            break;
          }
        } else {
          const lineEnd = incomingBuffer.indexOf('\r\n');
          if (lineEnd === -1) break;
          const line = incomingBuffer.slice(0, lineEnd);
          incomingBuffer = incomingBuffer.slice(lineEnd + 2);

          const trimmed = line.trim();
          if (!trimmed) continue;
          const upper = trimmed.toUpperCase();

          if (upper.startsWith('HELO') || upper.startsWith('EHLO')) {
            state = 'COMMAND';
            socket.write('250-127.0.0.1 Hello\r\n250-8BITMIME\r\n250 SIZE 10485760\r\n250 OK\r\n');
          } else if (upper.startsWith('MAIL FROM:')) {
            envelope.from = trimmed.slice(10).replace(/[<>]/g, '').trim();
            socket.write('250 2.1.0 Sender OK\r\n');
          } else if (upper.startsWith('RCPT TO:')) {
            const toAddr = trimmed.slice(8).replace(/[<>]/g, '').trim();
            envelope.to.push(toAddr);
            socket.write('250 2.1.5 Recipient OK\r\n');
          } else if (upper === 'DATA') {
            state = 'DATA';
            dataBuffer = '';
            socket.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
          } else if (upper === 'RSET') {
            envelope = { from: '', to: [] };
            dataBuffer = '';
            state = 'COMMAND';
            socket.write('250 2.0.0 OK Reset\r\n');
          } else if (upper === 'NOOP') {
            socket.write('250 2.0.0 OK\r\n');
          } else if (upper === 'QUIT') {
            socket.write('221 2.0.0 Bye\r\n');
            socket.end();
            break;
          } else {
            socket.write('500 5.5.1 Unrecognized command\r\n');
          }
        }
      }
    });

    socket.on('error', () => {});
  });

  // HTTP API Server for Sink Inspection
  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    // CORS for local testing/browser inspection
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'HEALTHY', sink: 'SMTP', count: emails.length }));
    }

    if (req.method === 'GET' && url.pathname === '/api/emails') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: emails }));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/emails/')) {
      const id = url.pathname.slice('/api/emails/'.length);
      const email = emails.find(e => e.id === id);
      if (!email) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'EMAIL_NOT_FOUND' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: email }));
    }

    if (req.method === 'DELETE' && url.pathname === '/api/emails') {
      emails.length = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: { cleared: true, count: 0 } }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });

  return {
    emails,
    start: () => Promise.all([
      new Promise((resolve, reject) => {
        smtpServer.listen(smtpPort, host, () => {
          console.log(`[SMTP Sink] Listening on smtp://${host}:${smtpPort}`);
          resolve();
        }).on('error', reject);
      }),
      new Promise((resolve, reject) => {
        httpServer.listen(httpPort, host, () => {
          console.log(`[SMTP Sink HTTP] Listening on http://${host}:${httpPort}`);
          resolve();
        }).on('error', reject);
      })
    ]),
    stop: () => Promise.all([
      new Promise(resolve => smtpServer.close(resolve)),
      new Promise(resolve => httpServer.close(resolve))
    ])
  };
}

if (process.argv[1] && process.argv[1].endsWith('smtp-sink.mjs')) {
  const sink = createSmtpSink({
    smtpPort: Number(process.env.SMTP_PORT || 1025),
    httpPort: Number(process.env.SMTP_HTTP_PORT || 1080),
    host: '127.0.0.1'
  });
  sink.start().catch(err => {
    console.error('Failed to start SMTP sink:', err);
    process.exit(1);
  });
}
