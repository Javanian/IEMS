import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { localUrl, submitLocalMail, verifiedSinkReceipt } from '../../apps/portfolio-api/src/automation-transport.mjs';

test('transport refuses external recipients and non-loopback receipt endpoints', async () => {
  for (const url of ['https://127.0.0.1', 'http://example.com', 'http://user:pass@127.0.0.1']) {
    assert.throws(() => localUrl(url), /AUTOMATION_LOOPBACK_REQUIRED/);
  }
  const delivery = { recipient: 'customer@example.com', subject: 'Synthetic', messageId: '<test@iems.local>', _id: 'synthetic', tenantId: 'tenant', plantId: 'plant', contentHash: 'hash', body: 'Synthetic' };
  await assert.rejects(submitLocalMail(delivery), /SYNTHETIC_MAIL_REQUIRED/);
  await assert.rejects(submitLocalMail({ ...delivery, recipient: 'customer@iems.local', body: 'x'.repeat(65537) }), /SYNTHETIC_MAIL_REQUIRED/);
});

test('receipt inspection does not follow a redirect carrying the private token', async t => {
  let destinationRequests = 0;
  const destination = http.createServer((req, res) => { destinationRequests++; res.end('{}'); });
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => destination.close(resolve)));
  const source = http.createServer((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${destination.address().port}/receipt` });
    res.end();
  });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => source.close(resolve)));
  await assert.rejects(verifiedSinkReceipt({ messageId: '<synthetic@iems.local>' }, {
    sinkToken: 'synthetic-test-token', sinkUrl: `http://127.0.0.1:${source.address().port}`
  }));
  assert.equal(destinationRequests, 0);
});
