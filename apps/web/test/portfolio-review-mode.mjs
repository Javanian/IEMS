export function reviewRunPlan(env={}) {
  const flag=env.PORTFOLIO_REVIEW_DEBUG_ONLY;
  if(flag!==undefined && flag!=='0' && flag!=='1')throw Error('PORTFOLIO_REVIEW_DEBUG_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const textFlag=env.PORTFOLIO_TEXT_DIAGNOSTIC_ONLY;
  if(textFlag!==undefined && textFlag!=='0' && textFlag!=='1')throw Error('PORTFOLIO_TEXT_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const companyFlag=env.PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY;
  if(companyFlag!==undefined && companyFlag!=='0' && companyFlag!=='1')throw Error('PORTFOLIO_COMPANY_STOCK_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const quoteFlag=env.PORTFOLIO_QUOTE_CATALOG_DIAGNOSTIC_ONLY;
  if(quoteFlag!==undefined && quoteFlag!=='0' && quoteFlag!=='1')throw Error('PORTFOLIO_QUOTE_CATALOG_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const purchasedFlag=env.PORTFOLIO_PURCHASED_FULFILLMENT_DIAGNOSTIC_ONLY;
  if(purchasedFlag!==undefined && purchasedFlag!=='0' && purchasedFlag!=='1')throw Error('PORTFOLIO_PURCHASED_FULFILLMENT_DIAGNOSTIC_ONLY must be 0 or 1. Use 0 for full acceptance.');
  const companyOnly=companyFlag==='1',quoteCatalogOnly=quoteFlag==='1',purchasedOnly=purchasedFlag==='1',textProbeOnly=textFlag==='1',reviewDebug=flag==='1',diagnosticOnly=reviewDebug || textProbeOnly || companyOnly || quoteCatalogOnly || purchasedOnly,e01=!companyOnly && !quoteCatalogOnly && !purchasedOnly && (reviewDebug || env.PORTFOLIO_REVIEW_E01==='1');
  if([textProbeOnly,reviewDebug,companyOnly,quoteCatalogOnly,purchasedOnly].filter(Boolean).length>1)throw Error('Choose one diagnostic entry: text probe, review journeys, company stock, catalog quote or purchased fulfillment.');
  return {
    diagnosticOnly,textProbeOnly,companyOnly,quoteCatalogOnly,purchasedOnly,e01,
    internalExecution:!companyOnly && !quoteCatalogOnly && !purchasedOnly && (reviewDebug || env.PORTFOLIO_INTERNAL_EXECUTION==='1'),
    companyStock:!quoteCatalogOnly && !purchasedOnly && (companyOnly || env.PORTFOLIO_COMPANY_STOCK==='1'),
    companyTrace:!quoteCatalogOnly && !purchasedOnly && env.PORTFOLIO_COMPANY_STOCK_TRACE==='1',
    quoteCatalog:!purchasedOnly && (quoteCatalogOnly || env.PORTFOLIO_QUOTE_CATALOG==='1'),
    purchasedFulfillment:purchasedOnly || !diagnosticOnly && env.PORTFOLIO_PURCHASED_FULFILLMENT==='1',
    operator:!companyOnly && !quoteCatalogOnly && !purchasedOnly && (reviewDebug || env.PORTFOLIO_REVIEW_OPERATOR==='1'),
    seedOperators:e01 || textProbeOnly,
    resultsFile:purchasedOnly ? 'purchased-fulfillment-debug-results.json' : quoteCatalogOnly ? 'quote-catalog-debug-results.json' : companyOnly ? 'company-stock-debug-results.json' : textProbeOnly ? 'review-text-probe-results.json' : diagnosticOnly ? 'review-debug-results.json' : 'browser-results.json',
    priorJourneyCoverage:!diagnosticOnly,
  };
}
