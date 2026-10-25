import assert from 'node:assert/strict';

// W4F-T1/T2: bounded text-enlargement proof for the invoice and ticket views (not WCAG certification).
// Double each element's measured font size without scaling the viewport; restore all inline overrides afterward.
const CONTROLS = `[...document.querySelectorAll('.pf-main a,.pf-main button,.pf-main input,.pf-main select,.pf-main textarea,.pf-main summary')].filter(x=>x.getClientRects().length>0&&getComputedStyle(x).visibility!=='hidden')`;
const PAINTED_TEXT_CAPTURE=`(()=>{const app=document.querySelector('.portfolio-root'),walker=document.createTreeWalker(app,NodeFilter.SHOW_TEXT),rows=[];let text;while(text=walker.nextNode()){if(!text.textContent.trim())continue;const node=text.parentElement,style=getComputedStyle(node),range=document.createRange();range.selectNodeContents(text);const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);if(!rects.length||style.visibility==='hidden'||style.display==='none')continue;rows.push({textNode:text,node,text:text.textContent.trim().slice(0,160),before:parseFloat(style.fontSize),nodeIndex:window.__portfolioTextNodes.indexOf(node),rects:rects.map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))});}window.__portfolioPaintedText=rows;return rows.length})()`;
const PAINTED_TEXT_MEASURE=`(window.__portfolioPaintedText||[]).map(row=>{const style=getComputedStyle(row.node),range=document.createRange();range.selectNodeContents(row.textNode);return {text:row.text,nodeIndex:row.nodeIndex,tag:row.node.tagName,before:row.before,expected:row.before*2,current:parseFloat(style.fontSize),inline:row.node.style.fontSize,connected:row.node.isConnected,visible:range.getClientRects().length>0&&style.visibility!=='hidden',rects:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))}})`;
async function cssEvidence(call,evaluate){
  await call('DOM.enable');await call('CSS.enable');
  const {root}=await call('DOM.getDocument',{depth:1}),{nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'.portfolio-root'});
  const matched=await call('CSS.getMatchedStylesForNode',{nodeId}),computed=await call('CSS.getComputedStyleForNode',{nodeId});
  const properties=await evaluate(`(()=>{const app=document.querySelector('.portfolio-root'),s=getComputedStyle(app);return {outerHTML:app.outerHTML.slice(0,500),directText:[...app.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(''),fontSize:s.fontSize,font:s.font,textSizeAdjust:s.getPropertyValue('text-size-adjust'),webkitTextSizeAdjust:s.getPropertyValue('-webkit-text-size-adjust'),zoom:s.zoom,fontSizeAdjust:s.fontSizeAdjust,animation:s.animation,transition:s.transition,devicePixelRatio,visualViewport:{scale:visualViewport.scale,width:visualViewport.width,height:visualViewport.height},viewport:document.querySelector('meta[name=viewport]')?.content}})()`);
  return {properties,computed,matched};
}
function measureScript(selector) {
  return `(()=>{const t=document.querySelector(${JSON.stringify(selector)});const r=t.getBoundingClientRect();
    const controls=${CONTROLS}.map(x=>{const b=x.getBoundingClientRect();return {id:x.tagName+':'+(x.name||x.textContent.trim().slice(0,40)),nodeIndex:window.__portfolioTextNodes.indexOf(x),font:parseFloat(getComputedStyle(x).fontSize),w:b.width,h:b.height,left:b.left,right:b.right}});
    return {text:t.textContent.trim().slice(0,60),font:parseFloat(getComputedStyle(t).fontSize),height:r.height,width:r.width,root:parseFloat(getComputedStyle(document.documentElement).fontSize),
      app:parseFloat(getComputedStyle(document.querySelector('.portfolio-root')).fontSize),appInline:document.querySelector('.portfolio-root').style.getPropertyValue('font-size'),appPriority:document.querySelector('.portfolio-root').style.getPropertyPriority('font-size'),appCount:document.querySelectorAll('.portfolio-root').length,sameApp:!window.__portfolioTextResize||window.__portfolioTextResize.app===document.querySelector('.portfolio-root'),sameTarget:!window.__portfolioTextResize||window.__portfolioTextResize.target===t,timeOrigin:performance.timeOrigin,overflow:document.documentElement.scrollWidth>innerWidth,innerWidth,controls}})()`;
}
export async function textEnlargementJourney({ db, call, wait, evaluate, screenshot, check, web,writeEvidence,invoiceOnly=false }) {
  const invoice = await db.collection('fulfillmentInvoices').findOne({});
  const ticket = await db.collection('cs_tickets').findOne({});
  assert.ok(invoice && (invoiceOnly || ticket), 'invoice and required ticket records exist from earlier journeys');
  const views = [
    { name: 'invoice', path: `fulfillment/invoices/${invoice._id}`, ready: '.pf-dl dd', target: '.pf-dl dd', focusFrom: 'Refresh record' },
    ...(!invoiceOnly ? [{ name: 'ticket', path: `service/tickets/${ticket._id}`, ready: '[name=publicText]:not(:disabled)', target: '.pf-ticket-description', focusFrom: 'Refresh ticket' }] : []),
  ];
  const results = [];
  await call('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });
  for (const view of views) {
    await call('Page.navigate', { url: `${web}/portfolio/${view.path}` });
    await wait(`location.pathname==='/portfolio/${view.path}' && document.querySelector('${view.ready}') && document.querySelector('${view.target}') && !document.body.innerText.includes('Loading current records')`, `${view.name} ready`);
    await evaluate('(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const app=document.querySelector(".portfolio-root");window.__portfolioTextNodes=[app,...app.querySelectorAll("*")];return true})()');
    await evaluate(PAINTED_TEXT_CAPTURE);
    const before = await evaluate(measureScript(view.target));
    const beforeCss=await cssEvidence(call,evaluate);
    assert.equal(before.root, 16, 'baseline browser default font size'); assert.equal(before.overflow, false);
    const immediate=await evaluate(`(()=>{const app=document.querySelector('.portfolio-root'),nodes=[app,...app.querySelectorAll('*')];window.__portfolioTextResize={app,target:document.querySelector(${JSON.stringify(view.target)}),nodes:nodes.map(node=>({node,size:parseFloat(getComputedStyle(node).fontSize),original:node.style.getPropertyValue('font-size'),priority:node.style.getPropertyPriority('font-size')}))};for(const row of window.__portfolioTextResize.nodes)row.node.style.setProperty('font-size',row.size*2+'px');return ${measureScript(view.target)}})()`);
    try {
      await wait(`window.__portfolioTextResize?.app===document.querySelector('.portfolio-root') && window.__portfolioTextResize?.target===document.querySelector('${view.target}') && parseFloat(getComputedStyle(document.querySelector('.portfolio-root')).fontSize)===${before.app * 2} && parseFloat(getComputedStyle(document.querySelector('${view.target}')).fontSize)===${before.font * 2}`, `${view.name} same application and target text doubled`);
      const after = await evaluate(measureScript(view.target));
      assert.equal(after.text, before.text, 'same text element');
      assert.equal(after.sameApp,true,'same application root after enlargement');assert.equal(after.sameTarget,true,'same target DOM node after enlargement');
      assert.equal(after.root, before.root, 'viewport and root scale unchanged'); assert.equal(after.app, before.app * 2);
      assert.ok(Math.abs(after.font / before.font - 2) < 0.01, `computed ${before.font} -> ${after.font}`);
      assert.ok(after.height >= before.height * 1.8, `rendered height ${before.height} -> ${after.height}`);
      assert.equal(after.overflow, false, `${view.name} horizontal overflow at 200% text`);
      assert.deepEqual(after.controls.map(c => [c.nodeIndex,c.id]), before.controls.map(c => [c.nodeIndex,c.id]), 'no visible control lost, including closed audit summaries');
      const lost = after.controls.filter(c => !c.w || !c.h || c.left < -1 || c.right > after.innerWidth + 1).map(c => c.id);
      assert.deepEqual(lost, [], 'controls stay inside the viewport');
      // Keyboard: Tab from a known control; every step lands on a visible control with a solid focus outline.
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(view.focusFrom)}).focus()`);
      const focused = [];
      for (let i = 0; i < 4; i++) {
        await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        const f = await evaluate(`(()=>{const a=document.activeElement;const r=a.getBoundingClientRect();return {id:a.tagName+':'+(a.name||a.textContent.trim().slice(0,40)),nodeIndex:window.__portfolioTextResize.nodes.findIndex(row=>row.node===a),outline:getComputedStyle(a).outlineStyle,inView:r.top>=0&&r.bottom<=innerHeight+1&&r.left>=-1&&r.right<=innerWidth+1,inMain:Boolean(a.closest('.portfolio-root'))}})()`);
        assert.equal(f.inMain, true, `focus left the app: ${f.id}`); assert.equal(f.outline, 'solid', `focus outline on ${f.id}`); assert.equal(f.inView, true, `focused ${f.id} visible`);
        assert.ok(f.nodeIndex>=0,'focused control belongs to the enlarged DOM nodes');focused.push(f);
      }
      assert.equal(new Set(focused.map(row=>row.nodeIndex)).size, focused.length, 'Tab advances to distinct actual DOM nodes');
      await evaluate(`document.querySelector('${view.target}').scrollIntoView({block:'center'})`);
      const persisted=await evaluate(measureScript(view.target));assert.equal(persisted.app,before.app*2,'application text stays doubled through keyboard checks');assert.equal(persisted.font,before.font*2,'target text stays doubled through keyboard checks');
      await screenshot(`wave4f-${view.name}-text200-375`);
      await writeEvidence?.(`wave4f-${view.name}-text200-proof.json`,{before,immediate,after,persisted,focused,paintedText:await evaluate(PAINTED_TEXT_MEASURE),beforeCss,afterCss:await cssEvidence(call,evaluate)});
      results.push({ view: view.name, method: 'measured per-element computed font sizes doubled', element: view.target, text: before.text, before: { font: before.font, height: before.height, root: before.root, app: before.app }, after: { font: after.font, height: after.height, root: after.root, app: after.app }, controls: before.controls.length, focused });
    } catch(error) {
      const current=await evaluate(measureScript(view.target)).catch(failure=>({measurementError:String(failure)}));
      const paintedText=await evaluate(PAINTED_TEXT_MEASURE),afterCss=await cssEvidence(call,evaluate),settling=[];
      for(const [phase,pause] of [['two-animation-frames',`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`],['after-100ms','await new Promise(resolve=>setTimeout(resolve,100))'],['after-500ms','await new Promise(resolve=>setTimeout(resolve,500))']]){
        settling.push({phase,measurement:await evaluate(`(async()=>{${pause};return ${measureScript(view.target)}})()`),paintedText:await evaluate(PAINTED_TEXT_MEASURE)});
      }
      const diagnostic={view:view.name,error:String(error),before,immediate,current,paintedText,beforeCss,afterCss,settling};console.log('W4F text diagnostic before restore',JSON.stringify({view:view.name,error:String(error),before,immediate,current,paintedTextSummary:{count:paintedText.length,notDoubled:paintedText.filter(row=>row.current!==row.expected)},settling:settling.map(row=>({phase:row.phase,app:row.measurement.app,font:row.measurement.font}))}));
      await writeEvidence?.(`wave4f-${view.name}-text200-failure-before-restore.json`,diagnostic);
      await screenshot(`wave4f-${view.name}-text200-failure-before-restore`);throw error;
    } finally {
      await evaluate(`(()=>{for(const row of window.__portfolioTextResize?.nodes || []){if(row.original)row.node.style.setProperty('font-size',row.original,row.priority);else row.node.style.removeProperty('font-size');}delete window.__portfolioTextResize;delete window.__portfolioTextNodes;delete window.__portfolioPaintedText})()`);
    }
    await wait(`parseFloat(getComputedStyle(document.querySelector('${view.target}')).fontSize)===${before.font}`, `${view.name} restored`);
  }
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  console.log('W4F text enlargement', JSON.stringify(results));
  check(`${invoiceOnly ? 'Diagnostic invoice-only' : 'W4F-T1/T2 invoice and ticket'} text enlargement at375px: unchanged browser root; application and same target computed font sizes doubled (${results.map(r => `${r.view} ${r.before.font}->${r.after.font}px`).join(', ')}) and rendered height, no overflow, all controls kept in view, keyboard Tab visible with outline`);
  return results;
}
