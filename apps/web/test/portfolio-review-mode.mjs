export function reviewRunPlan(env={}) {
  const flag=env.PORTFOLIO_REVIEW_DEBUG_ONLY;
  if(flag!==undefined && flag!=='0' && flag!=='1')throw Error('PORTFOLIO_REVIEW_DEBUG_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const textFlag=env.PORTFOLIO_TEXT_DIAGNOSTIC_ONLY;
  if(textFlag!==undefined && textFlag!=='0' && textFlag!=='1')throw Error('PORTFOLIO_TEXT_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const textProbeOnly=textFlag==='1',reviewDebug=flag==='1',diagnosticOnly=reviewDebug || textProbeOnly,e01=reviewDebug || env.PORTFOLIO_REVIEW_E01==='1';
  if(textProbeOnly && reviewDebug)throw Error('Choose one diagnostic entry: text probe or review journeys.');
  return {
    diagnosticOnly,textProbeOnly,e01,
    internalExecution:reviewDebug || env.PORTFOLIO_INTERNAL_EXECUTION==='1',
    operator:reviewDebug || env.PORTFOLIO_REVIEW_OPERATOR==='1',
    seedOperators:e01 || textProbeOnly,
    resultsFile:textProbeOnly ? 'review-text-probe-results.json' : diagnosticOnly ? 'review-debug-results.json' : 'browser-results.json',
    priorJourneyCoverage:!diagnosticOnly,
  };
}
