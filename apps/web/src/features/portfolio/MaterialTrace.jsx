import { Link } from 'react-router-dom';

export function MaterialTrace({ trace, output = false }) {
  const rows = Array.isArray(trace) ? trace : trace ? [trace] : [];
  if (!rows.length) return <p>No lot/heat metadata recorded.</p>;
  return <><h3>Material lot/heat context</h3>{output && <p>Linked material receipts for this work order. This does not establish which material was installed in an individual output unit.</p>}<ul className="pf-list">{rows.map(row => <li key={row.receiptId}><Link to={`/portfolio/warehouse/receipts/${row.receiptId}`}>Receipt {row.receiptId}</Link><span>Lot: {row.lotNumber} · Heat: {row.heatNumber}</span></li>)}</ul></>;
}
