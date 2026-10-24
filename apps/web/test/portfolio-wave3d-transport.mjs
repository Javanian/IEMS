import assert from 'node:assert/strict';

// Pause only the real response; the API transaction has already completed.
export function responseLoss({ call, subscribe }) {
  return async function loseResponse(urlPattern, submit, committed) {
    let resolvePause, rejectPause;
    const paused = new Promise((resolve, reject) => { resolvePause = resolve; rejectPause = reject; });
    const unsubscribe = subscribe(async event => {
      if (event.method !== 'Fetch.requestPaused') return;
      const p = event.params;
      try {
        assert.ok(p.responseStatusCode >= 200 && p.responseStatusCode < 300);
        const body = await call('Fetch.getResponseBody', { requestId: p.requestId });
        const receipt = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body);
        const command = JSON.parse(p.request.postData);
        await committed({ command, receipt, headers: p.request.headers });
        await call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionClosed' });
        resolvePause({ command, receipt, headers: p.request.headers });
      } catch (error) { rejectPause(error); }
    });
    await call('Fetch.enable', { patterns: [{ urlPattern, requestStage: 'Response' }] });
    try { await submit(); return await paused; }
    finally { unsubscribe(); await call('Fetch.disable'); }
  };
}
