import { Fragment } from 'react';
import { monetaryRows } from './monetary.mjs';

export function MonetarySummary({ record }) {
  let rows;
  try { rows = monetaryRows(record); }
  catch (error) { return <p role="alert" className="pf-error">{error.message}</p>; }
  return <div className="pf-monetary"><p>Tax policy: {record.taxPolicy || 'NO_TAX'}{record.taxPolicyVersion !== undefined && ` · Policy version ${record.taxPolicyVersion}`}</p>{record.taxPolicy === 'FIXTURE_VAT_11_V1' && <p>Fixture VAT only, not statutory tax.</p>}<dl className="pf-dl">{rows.map(([label, amount]) => <Fragment key={label}><dt>{label}</dt><dd className="pf-money">{record.currency} {amount}</dd></Fragment>)}</dl></div>;
}
