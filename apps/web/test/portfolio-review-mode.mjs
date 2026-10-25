export function reviewRunPlan(env={}) {
  const flag=env.PORTFOLIO_REVIEW_DEBUG_ONLY;
  if(flag!==undefined && flag!=='0' && flag!=='1')throw Error('PORTFOLIO_REVIEW_DEBUG_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const textFlag=env.PORTFOLIO_TEXT_DIAGNOSTIC_ONLY;
  if(textFlag!==undefined && textFlag!=='0' && textFlag!=='1')throw Error('PORTFOLIO_TEXT_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const companyFlag=env.PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY;
  if(companyFlag!==undefined && companyFlag!=='0' && companyFlag!=='1')throw Error('PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const quoteFlag=env.PORTFOLIO_QUOTE_CATALOG_DIAGNOSTIC_ONLY;
  if(quoteFlag!==undefined && quoteFlag!=='0' && quoteFlag!=='1')throw Error('PORTFOLIO_QUOTE_CATALOG_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const companyOnly=companyFlag==='1',quoteCatalogOnly=quoteFlag==='1',textProbeOnly=textFlag==='1',reviewDebug=flag==='1',diagnosticOnly=reviewDebug || textProbeOnly || companyOnly || quoteCatalogOnly,e01=!companyOnly && !quoteCatalogOnly && (reviewDebug || env.PORTFOLIO_REVIEW_E01==='1');
  if([textProbeOnly,reviewDebug,companyOnly,quoteCatalogOnly].filter(Boolean).length>1)throw Error('Choose one diagnostic entry: text probe, review journeys, company stock or catalog quote.');
  return {
    diagnosticOnly,textProbeOnly,companyOnly,quoteCatalogOnly,e01,
    internalExecution:!companyOnly && !quoteCatalogOnly && (reviewDebug || env.PORTFOLIO_INTERNAL_EXECUTION==='1'),
    companyStock:!quoteCatalogOnly && (companyOnly || env.PORTFOLIO_COMPANY_STOCK==='1'),
    companyTrace:!quoteCatalogOnly && env.PORTFOLIO_COMPANY_STOCK_TRACE==='1',
    quoteCatalog:quoteCatalogOnly || env.PORTFOLIO_QUOTE_CATALOG==='1',
    operator:!companyOnly && !quoteCatalogOnly && (reviewDebug || env.PORTFOLIO_REVIEW_OPERATOR==='1'),
    seedOperators:e01 || textProbeOnly,
    resultsFile:quoteCatalogOnly ? 'quote-catalog-debug-results.json' : companyOnly ? 'company-stock-debug-results.json' : textProbeOnly ? 'review-text-probe-results.json' : diagnosticOnly ? 'review-debug-results.json' : 'browser-results.json',
    priorJourneyCoverage:!diagnosticOnly,
  };
}
