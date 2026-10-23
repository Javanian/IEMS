const fail = code => { throw new Error(code); };
const minor = value => BigInt(value.replace('.', ''));
const tax = net => (net * 22n + 100n) / 200n;
export function vatContent(kind, body, validateNet) {
  if (!['quote','invoice'].includes(kind) || body.taxPolicyVersion !== 1 || body.taxRate !== '0.11') fail('INVALID_POLICY');
  if (!Array.isArray(body.lines) || !body.lines.length) fail('INVALID_LINES');
  const cumulative = kind === 'invoice';
  if (body.roundingPolicy !== (cumulative ? 'CUMULATIVE_HALF_UP' : 'LINE_HALF_UP')) fail('INVALID_POLICY');
  const provenance = [];
  const linesForNet = body.lines.map(line => {
    if (!cumulative) return { ...line, amount:line.netAmount };
    const r=line.rounding;
    const keys='afterAmount,afterGrossAmount,afterQuantity,afterTaxAmount,beforeAmount,beforeGrossAmount,beforeQuantity,beforeTaxAmount,lineIndex,quoteRevision,sourceId,sourceVersion,taxPolicyVersion';
    if (!r || Object.keys(r).sort().join(',') !== keys || r.sourceId !== body.salesOrderId || r.sourceVersion !== body.salesOrderVersion || r.quoteRevision !== body.quoteRevision || r.taxPolicyVersion !== 1 || line.lineIndex !== r.lineIndex || typeof line.shipmentId !== 'string' || !line.shipmentId || !Number.isSafeInteger(body.salesOrderVersion) || body.salesOrderVersion < 1 || !Number.isSafeInteger(body.quoteRevision) || body.quoteRevision < 1) fail('INVALID_PROVENANCE');
    const { sourceVersion,quoteRevision,taxPolicyVersion,beforeTaxAmount,afterTaxAmount,beforeGrossAmount,afterGrossAmount,...netRounding }=r;
    provenance.push({ ...r });
    return { ...line, amount:line.netAmount, rounding:netRounding };
  });
  const net = validateNet({ ...body, schemaVersion:1, taxPolicy:'NO_TAX', total:body.netAmount, lines:linesForNet });
  const checked = (actual, expected) => { if (actual !== expected) fail('TAX_AMOUNT_MISMATCH'); return actual; };
  const scale = net.currency === 'JPY' ? 0 : net.currency === 'KWD' ? 3 : 2;
  const format = n => { const s=n.toString().padStart(scale+1,'0'); return scale ? `${s.slice(0,-scale)}.${s.slice(-scale)}` : s; };
  let taxTotal=0n;
  const lines=net.lines.map((line,i) => {
    const input=body.lines[i], amount=minor(line.amount);
    const r=provenance[i];
    let taxAmount=tax(amount);
    if (cumulative) {
      const before=minor(r.beforeAmount), after=minor(r.afterAmount);
      checked(r.beforeTaxAmount,format(tax(before))); checked(r.afterTaxAmount,format(tax(after)));
      checked(r.beforeGrossAmount,format(before+tax(before))); checked(r.afterGrossAmount,format(after+tax(after)));
      taxAmount=tax(after)-tax(before);
    }
    taxTotal+=taxAmount;
    if(input.amount !== undefined) checked(input.amount,line.amount);
    return { ...line, netAmount:checked(input.netAmount,line.amount), taxAmount:checked(input.taxAmount,format(taxAmount)), grossAmount:checked(input.grossAmount,format(amount+taxAmount)), ...(cumulative ? { shipmentId:input.shipmentId, lineIndex:input.lineIndex, rounding:r } : {}) };
  });
  const netAmount=net.total, taxAmount=checked(body.taxAmount,format(taxTotal)), grossAmount=checked(body.grossAmount,format(minor(netAmount)+taxTotal));
  checked(body.total,grossAmount);
  return { ...net, total:grossAmount, netAmount,taxAmount,grossAmount,taxPolicy:'FIXTURE_VAT_11_V1', taxPolicyVersion:1,taxRate:'0.11',lines, ...(cumulative ? { salesOrderId:body.salesOrderId, salesOrderVersion:body.salesOrderVersion, quoteRevision:body.quoteRevision } : {}) };
}
