import { companyStockBase } from './company-stock.mjs';

export const traceUseGroups = [
  ['reserved', 'Reserved for production'],
  ['issued', 'Issued, awaiting consumption'],
  ['consumedUnattributed', 'Consumed, awaiting attribution'],
  ['outputs', 'Affected output candidates'],
  ['losses', 'Recorded process loss'],
  ['abandoned', 'Abandoned reservations (history only)'],
];
const text = value => typeof value === 'string' && value.length > 0;
const version = value => Number.isSafeInteger(value) && value > 0;
const rawSource = source => source && text(source.receiptId) && text(source.quantity) && text(source.uom) && (source.serials === undefined || Array.isArray(source.serials) && source.serials.every(text));
const useRecord = use => use && text(use.reservationId) && text(use.reservationStatus) && text(use.selectedQuantity) && text(use.consumer?.executionId) && text(use.consumer?.status) && (!use.output || text(use.output.serial) && text(use.output.status) && [null,'ACCEPTED','REJECTED'].includes(use.output.qcDisposition));
export function companyUnitTracePath(receiptId, unitId) {
  return `${companyStockBase}/${encodeURIComponent(receiptId)}/units/${encodeURIComponent(unitId)}/trace`;
}
export function currentCompanyUnitTrace(binding, resource) {
  const data = resource.data;
  return !resource.loading && !resource.error && data && !Array.isArray(data)
    && data.schema === 'COMPANY_UNIT_TRACE_V1'
    && data.companyReceiptId === binding.receiptId && data.companyUnitId === binding.unitId
    && text(data.serial) && ['ONE_HOP_SOURCE','LEAF_ONLY'].includes(data.sourcePolicy)
    && text(data.itemSnapshot?.code) && text(data.itemSnapshot?.content?.description) && text(data.locationSnapshot?.code)
    && version(data.current?.stockVersion) && version(data.current?.unitVersion) && text(data.current?.status) && typeof data.current?.eligible === 'boolean' && Array.isArray(data.current?.blockers) && data.current.blockers.every(text)
    && text(data.producer?.executionId)
    && data.completeness?.complete === true && data.completeness?.oneGeneration === true
    && data.ancestry?.basis === 'EXACT_OUTPUT_ATTRIBUTION'
    && Array.isArray(data.ancestry.purchasedSources) && data.ancestry.purchasedSources.every(rawSource)
    && Array.isArray(data.ancestry.companySources) && data.ancestry.companySources.every(source => source && text(source.companyReceiptId) && text(source.companyUnitId) && text(source.serial) && text(source.quantity) && text(source.producerExecutionId) && Array.isArray(source.purchasedSources) && source.purchasedSources.every(rawSource))
    && data.holdPolicy?.basis === 'CONSERVATIVE_CONSUMED_BATCH' && Array.isArray(data.holdPolicy.receiptIds) && data.holdPolicy.receiptIds.every(text)
    && (!data.holdPolicy.directHold || typeof data.holdPolicy.directHold.active === 'boolean' && text(data.holdPolicy.directHold.reason))
    && traceUseGroups.every(([key]) => Array.isArray(data.uses?.[key]) && data.uses[key].every(use => useRecord(use) && (key !== 'outputs' || !!use.output) && (key !== 'losses' || text(use.quantity)))) ? data : null;
}
export function companyTraceHint(error) {
  if (error?.code === 'TRACE_LIMIT_EXCEEDED') return 'The complete trace exceeds the safe read limit. Ask an authorized reviewer to inspect the retained source records. No partial trace is shown.';
  if (typeof error?.code === 'string' && /_SOURCE_INVALID$/.test(error.code)) return 'The retained source evidence could not be verified. Refresh the receipt and ask an authorized reviewer to inspect its history. Do not treat this as a complete trace.';
  return '';
}
