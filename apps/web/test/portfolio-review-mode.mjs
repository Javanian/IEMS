export function reviewRunPlan(env={}) {
  const flag=env.PORTFOLIO_REVIEW_DEBUG_ONLY;
  if(flag!==undefined && flag!=='0' && flag!=='1')throw Error('PORTFOLIO_REVIEW_DEBUG_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const textFlag=env.PORTFOLIO_TEXT_DIAGNOSTIC_ONLY;
  if(textFlag!==undefined && textFlag!=='0' && textFlag!=='1')throw Error('PORTFOLIO_TEXT_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const companyFlag=env.PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY;
  if(companyFlag!==undefined && companyFlag!=='0' && companyFlag!=='1')throw Error('PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const companyOnly=companyFlag==='1',textProbeOnly=textFlag==='1',reviewDebug=flag==='1',diagnosticOnly=reviewDebug || textProbeOnly || companyOnly,e01=!companyOnly && (reviewDebug || env.PORTFOLIO_REVIEW_E01==='1');
  if([textProbeOnly,reviewDebug,companyOnly].filter(Boolean).length>1)throw Error('Choose one diagnostic entry: text probe, review journeys or company stock.');
  return {
    diagnosticOnly,textProbeOnly,companyOnly,e01,
    internalExecution:!companyOnly && (reviewDebug || env.PORTFOLIO_INTERNAL_EXECUTION==='1'),
    companyStock:companyOnly || env.PORTFOLIO_COMPANY_STOCK==='1',
    operator:!companyOnly && (reviewDebug || env.PORTFOLIO_REVIEW_OPERATOR==='1'),
    seedOperators:e01 || textProbeOnly,
    resultsFile:companyOnly ? 'company-stock-debug-results.json' : textProbeOnly ? 'review-text-probe-results.json' : diagnosticOnly ? 'review-debug-results.json' : 'browser-results.json',
    priorJourneyCoverage:!diagnosticOnly,
  };
}
