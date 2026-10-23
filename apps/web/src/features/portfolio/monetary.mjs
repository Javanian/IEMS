import { displayMoney, validMoney } from './client.mjs';

export function monetaryRows(record) {
  const vat = record.taxPolicy === 'FIXTURE_VAT_11_V1';
  if (record.taxPolicy !== undefined && record.taxPolicy !== 'NO_TAX' && !vat) throw Error('Unsupported monetary policy. Refresh the record.');
  const fields = vat ? [['Subtotal', 'netAmount'], ['Tax', 'taxAmount'], ['Total', 'grossAmount']] : [['Total', 'total']];
  if (record.paidAmount !== undefined) fields.push(['Paid', 'paidAmount']);
  if (record.outstandingAmount !== undefined) fields.push(['Balance', 'outstandingAmount']);
  return fields.map(([label, field]) => {
    if (!validMoney(record[field], record.currency)) throw Error('Incomplete monetary snapshot. Refresh the record.');
    return [label, displayMoney(record[field])];
  });
}
