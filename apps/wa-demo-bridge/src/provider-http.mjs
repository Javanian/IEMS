export function createProviderCallbackHandler(reconcile) {
  if (typeof reconcile !== 'function') throw new Error('INVALID_CALLBACK_HANDLER');
  return async function handle(req, res) {
    const respond = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return respond(405, { error: 'METHOD_NOT_ALLOWED' });
    if (req.headers['content-type'] !== 'application/json'
      || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
      return respond(415, { error: 'UNSUPPORTED_CALLBACK_FORMAT' });
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 4096) return respond(413, { error: 'CALLBACK_TOO_LARGE' });
        chunks.push(bytes);
      }
      const receipt = await reconcile({ rawBody: Buffer.concat(chunks),
        timestamp: req.headers['x-iems-timestamp'], signature: req.headers['x-iems-signature'] });
      return respond(200, receipt);
    } catch (error) {
      const status = [401, 409].includes(error?.status) ? error.status : 503;
      return respond(status, { error: status === 401 ? 'INVALID_PROVIDER_CALLBACK'
        : status === 409 ? 'PROVIDER_CALLBACK_CONFLICT' : 'CALLBACK_RECONCILIATION_UNAVAILABLE' });
    }
  };
}
