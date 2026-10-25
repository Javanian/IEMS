import assert from 'node:assert/strict';

// Pause only the real response; the API transaction has already completed.
export function responseLoss({ call, subscribe, timeoutMs=60000 }) {
  return async function loseResponse(urlPattern, submit, committed) {
    assert.equal(typeof submit,'function','Response loss requires a native submit callback.');
    assert.equal(typeof committed,'function','Response loss requires a committed-state proof callback.');
    assert.ok(Number.isFinite(timeoutMs) && timeoutMs>0,'Response-loss deadline must be positive.');
    let resolvePause, rejectPause, timer,phase='arming response interception',responseSeen=false;
    const paused = new Promise((resolve, reject) => { resolvePause = resolve; rejectPause = reject; });
    const unsubscribe = subscribe(async event => {
      if (event.method !== 'Fetch.requestPaused') return;
      responseSeen=true;phase='verifying committed response';
      const p = event.params;
      try {
        assert.ok(p.responseStatusCode >= 200 && p.responseStatusCode < 300);
        const body = await call('Fetch.getResponseBody', { requestId: p.requestId });
        const receipt = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body);
        const command = JSON.parse(p.request.postData);
        await committed({ command, receipt, headers: p.request.headers });
        phase='failing the committed response';
        await call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionClosed' });
        resolvePause({ command, receipt, headers: p.request.headers });
      } catch (error) { rejectPause(error); }
    });
    try {
      await call('Fetch.enable', { patterns: [{ urlPattern, requestStage: 'Response' }] });
      phase='dispatching native submit';
      const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error(`Response-loss deadline ${timeoutMs}ms: ${urlPattern}; ${phase}. Submit is never repeated automatically.`)),timeoutMs);});
      const submitted=Promise.resolve().then(submit).then(()=>{if(!responseSeen)phase='waiting for matching response';});
      const completed=Promise.all([submitted,paused]).then(([,receipt])=>receipt);
      return await Promise.race([completed,deadline]);
    } finally { clearTimeout(timer);unsubscribe();await call('Fetch.disable'); }
  };
}
