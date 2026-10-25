export const companyStockBase = '/api/company-stock/receipts';
const positiveVersion = value => Number.isSafeInteger(value) && value > 0;
export const companyUnitId = unit => unit?.companyUnitId || unit?._id;
const companyRestrictions = {
  LEAF_ONLY:'This final output is retained in storage. Further component reuse and customer dispatch are unavailable.',
  COMPANY_SOURCE_TERMINAL:'This final output cannot supply another production job. Choose an eligible purchased-input producer.',
  COMPANY_STOCK_SOURCE_INVALID:'Manufactured stock evidence is incomplete or inconsistent. Refresh it and ask an authorized reviewer to inspect its retained history before use.',
  PRODUCER_DEMAND_CHANGED:'The producer approval or its source demand changed. Review the producer plan before using this manufactured stock.',
  COMPANY_DEPENDENCY_CHANGED:'A producer, item, location or source approval changed. Refresh the manufactured stock and review its current restrictions.',
  COMPANY_SOURCE_HELD:'A company stock hold blocks new component use. Review or release the hold with the appropriate permission.',
  ANCESTOR_HELD:'A consumed purchased source is on hold. Review that receipt before continuing this job.',
};
export const companyStockRestriction = code => companyRestrictions[code];
export const companyStockHint = error => error?.local ? error.message : companyRestrictions[error?.code];
export function companyStockOptionsPath(material, cursor = '') {
  return `${companyStockBase}?itemId=${encodeURIComponent(material.itemId)}&itemRevision=${material.itemRevision}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}
export function currentCompanyStock(selected, resource) {
  const row = resource.data;
  return !resource.loading && !resource.error && row && !Array.isArray(row) && typeof row._id === 'string' && !!row._id && row._id === selected?._id && typeof row.uom === 'string' && Array.isArray(row.units) ? row : null;
}
export function companyStockVersionMatches(captured, current) {
  return !!captured && !!current && typeof captured._id === 'string' && !!captured._id && Array.isArray(captured.units) && Array.isArray(current.units) && captured._id === current._id && positiveVersion(captured.version) && captured.version === current.version && current.sourcePolicy === 'ONE_HOP_SOURCE' && current.canReserve === true && captured.units.every(unit => typeof companyUnitId(unit) === 'string' && !!companyUnitId(unit) && positiveVersion(unit.version) && current.units.some(now => companyUnitId(now) === companyUnitId(unit) && now.version === unit.version));
}
export function companyReservationFields(source, values) {
  if (!source || !Array.isArray(source.units)) throw Object.assign(Error('Refresh current manufactured stock evidence before choosing units.'), { status:400, local:true });
  const ids = values.companyUnitIds || [];
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length || !source.canReserve || source.sourcePolicy !== 'ONE_HOP_SOURCE' || !positiveVersion(source.version)) throw Object.assign(Error('Select actual available manufactured units from the current stock receipt.'), { status:400, local:true });
  const units = ids.map(id => source.units.find(unit => companyUnitId(unit) === id));
  if (units.some(unit => !unit || unit.status !== 'AVAILABLE' || !unit.eligible || !positiveVersion(unit.version))) throw Object.assign(Error('Select actual available manufactured units from the current stock receipt.'), { status:400, local:true });
  if (!/^[1-9][0-9]*(?:\.0{1,6})?$/.test(values.quantity) || Number(values.quantity) !== ids.length) throw Object.assign(Error('Enter an integral quantity matching the selected manufactured units.'), { status:400, local:true });
  return { sourceKind:'COMPANY_OUTPUT', companyReceiptId:source._id, expectedStockVersion:source.version, quantity:values.quantity, units:units.map(unit => ({ companyUnitId:companyUnitId(unit), expectedUnitVersion:unit.version })) };
}
export function companyStockCommand(source, values, key, release = false) {
  return { expectedVersion:source.version, reason:values.reason, idempotencyKey:key, ...(release ? { expectedHoldId:source.hold._id } : { reasonCode:values.reasonCode }) };
}
export function mixedAttributionSources(sources, values) {
  return sources.flatMap((source,index) => {
    const quantity = String(values[`quantity${index}`] || '').trim();
    if (!quantity || /^0(?:\.0{1,6})?$/.test(quantity)) return [];
    return source.sourceKind === 'COMPANY_OUTPUT'
      ? [{ sourceKind:'COMPANY_OUTPUT', companyReceiptId:source._id, quantity, companyUnitIds:values[`companyUnitIds${index}`] || [] }]
      : [{ sourceKind:'CATALOG_RECEIPT', receiptId:source.receiptId, quantity, ...(source.source.trackingPolicy === 'SERIAL' ? { serials:values[`serials${index}`] || [] } : {}) }];
  });
}
export function consumedCompanyUnits(source, view) {
  const ids = new Set(view.reservations.filter(row => row.sourceKind === 'COMPANY_OUTPUT' && row.companyReceiptId === source._id && row.status === 'CONSUMED').flatMap(row => row.companyUnitIds));
  return source.units.filter(unit => ids.has(companyUnitId(unit)));
}
export function reservationFields(view, material, source, values) {
  if (view.schema === 'INTERNAL_EXECUTION_V2' && material.sourceKind === 'COMPANY_OUTPUT') return { materialLineId:material.lineId, ...companyReservationFields(source,values) };
  return { materialLineId:material.lineId, ...(view.schema === 'INTERNAL_EXECUTION_V2' ? { sourceKind:'CATALOG_RECEIPT' } : {}), receiptId:source.receiptId, expectedReceiptVersion:source.receiptVersion, expectedStockVersion:source.version, quantity:values.quantity, ...(material.itemSnapshot.content.trackingPolicy === 'SERIAL' ? { serials:values.serials || [] } : {}) };
}
