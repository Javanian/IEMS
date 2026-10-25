import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const stockHash = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
export const stockHashless = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'contentHash'));
export const stockSemantic = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['eventId', 'authorityHash', 'useFence'].includes(key)));
export const stockUnits = value => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value)) stockInvalid(); return BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0')); };
export const stockDecimal = value => { const text = value.toString().padStart(7, '0'); return `${text.slice(0, -6)}.${text.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };
export const stockInvalid = () => { throw Object.assign(new Error('CATALOG_STOCK_SOURCE_INVALID'), { status: 409, code: 'CATALOG_STOCK_SOURCE_INVALID' }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const scope = row => ({ tenantId: row.tenantId, plantId: row.plantId });

export async function validateCatalogStockUse(db, receipt, origin, opening, session) {
  const filter = { ...scope(receipt), receiptId: receipt._id }, options = { session }, hash = stockHash;
  const head = await db.collection('catalogUseHeads').findOne({ ...scope(receipt), _id: receipt._id }, options), reservations = await db.collection('catalogMaterialReservations').find(filter, options).limit(101).toArray(), events = await db.collection('catalogUseEvents').find(filter, options).limit(402).toArray(), histories = await db.collection('catalogMaterialReservationRevisions').find(filter, options).limit(302).toArray(), issues = await db.collection('catalogMaterialIssues').find(filter, options).limit(101).toArray(), consumptions = await db.collection('catalogMaterialConsumptions').find(filter, options).limit(101).toArray();
  const stored = opening.head?.status === 'STORED', initial = stored ? stockUnits(opening.balance.acceptedQuantity) : 0n;
  if (!head) {
    if (reservations.length || events.length || histories.length || issues.length || consumptions.length || await db.collection('catalogUseHeads').findOne(filter, options) || await db.collection('internalExecutions').findOne({ ...scope(receipt), sourceReceiptIds: receipt._id }, options)) stockInvalid();
    for (const name of ['internalExecutionEvents', 'internalExecutionKeys', 'internalExecutionAudit', 'internalExecutionOutbox', 'internalAttributionRevisions', 'internalOutputUnits', 'internalCompanyStockReceipts', 'internalCompanyStockUnits']) if (await db.collection(name).findOne({ ...scope(receipt), sourceReceiptIds: receipt._id }, options)) stockInvalid();
    return { head: null, version: 1, reservations: [], onHandQuantity: stockDecimal(initial), reservedQuantity: '0', issuedQuantity: '0', consumedQuantity: '0', availableQuantity: stockDecimal(initial), units: opening.units.map(unit => ({ ...unit, openingStatus: unit.status, status: unit.status })) };
  }
  if (!stored || head.receiptId !== receipt._id || head.originHash !== origin.contentHash || head.openingBalanceHash !== opening.balance.contentHash || !positive(head.version) || head.version < 2 || reservations.length > 100 || events.length > 400 || histories.length > 300 || events.length !== head.version - 1 || !Array.isArray(head.refs) || head.refs.length !== reservations.length) stockInvalid();
  const currentEvent = events.find(event => event._id === head.eventId), versions = events.map(event => event.version).sort((a, b) => a - b);
  if (!currentEvent || currentEvent.contentHash !== head.authorityHash || hash(currentEvent.snapshot) !== head.authorityHash || hash(stockSemantic(head)) !== head.authorityHash || versions.some((version, index) => version !== index + 2)) stockInvalid();
  for (const event of events) if (hash(event.snapshot) !== event.contentHash || event.snapshot.receiptId !== receipt._id || event.snapshot.version !== event.version || event.snapshot.originHash !== origin.contentHash || event.snapshot.openingBalanceHash !== opening.balance.contentHash) stockInvalid();
  let reserved = 0n, issued = 0n, consumed = 0n;
  const occupied = new Map(), seenIssues = new Set(), seenConsumptions = new Set();
  if (new Set(head.refs.map(row => row.reservationId)).size !== head.refs.length || histories.length !== reservations.reduce((count, row) => count + row.version, 0)) stockInvalid();
  for (const row of reservations) {
    const pointer = head.refs.find(ref => ref.reservationId === row._id), revisions = histories.filter(history => history.reservationId === row._id).sort((a, b) => a.version - b.version), amount = stockUnits(row.quantity);
    if (!pointer || !positive(row.version) || row.version > 3 || pointer.version !== row.version || pointer.contentHash !== row.contentHash || hash(stockHashless(row)) !== row.contentHash || row.originHash !== origin.contentHash || row.openingBalanceHash !== opening.balance.contentHash || row.itemId !== origin.source.itemId || row.itemRevision !== origin.source.itemRevision || row.uom !== receipt.uom || row.ownerLegalEntityId !== origin.source.ownerLegalEntityId || amount <= 0n || !['RESERVED', 'ISSUED', 'CONSUMED', 'RELEASED'].includes(row.status) || !Array.isArray(row.serials) || revisions.length !== row.version) stockInvalid();
    let previous = null;
    for (let index = 0; index < revisions.length; index++) {
      const history = revisions[index], snapshot = history.snapshot;
      const bindingKeys = ['executionId', 'materialLineId', 'receiptId', 'originHash', 'openingBalanceHash', 'itemId', 'itemRevision', 'uom', 'ownerLegalEntityId', 'quantity', 'serials', 'sourceSnapshot'];
      const binding = value => Object.fromEntries(bindingKeys.map(key => [key, value[key]]));
      if (history.version !== index + 1 || hash(stockHashless(history)) !== history.contentHash || snapshot._id !== row._id || snapshot.receiptId !== receipt._id || snapshot.version !== history.version || hash(stockHashless(snapshot)) !== snapshot.contentHash || snapshot.previousHash !== (previous?.contentHash || null) || (previous && hash(binding(snapshot)) !== hash(binding(previous)))) stockInvalid();
      if (index === 0 ? snapshot.status !== 'RESERVED' : previous.status === 'RESERVED' ? !['ISSUED', 'RELEASED'].includes(snapshot.status) : previous.status !== 'ISSUED' || snapshot.status !== 'CONSUMED') stockInvalid(); previous = snapshot;
    }
    if (hash(previous) !== hash(row)) stockInvalid();
    const execution = await db.collection('internalExecutions').findOne({ ...scope(receipt), _id: row.executionId }, options), executionEvent = execution && await db.collection('internalExecutionEvents').findOne({ ...scope(receipt), _id: execution.eventId, executionId: execution._id }, options);
    if (!execution || !executionEvent || executionEvent.contentHash !== execution.authorityHash || executionEvent.version !== execution.version || executionEvent.status !== execution.status || hash(executionEvent.snapshot) !== execution.authorityHash || hash(stockSemantic(execution)) !== execution.authorityHash || !execution.sourceReceiptIds.includes(receipt._id) || !execution.reservations.some(ref => ref.reservationId === row._id && ref.version === row.version && ref.contentHash === row.contentHash)) stockInvalid();
    if (origin.source.trackingPolicy === 'LOT' ? row.serials.length !== 0 : row.serials.length < 1 || new Set(row.serials).size !== row.serials.length || amount !== BigInt(row.serials.length) * 1000000n || row.serials.some(serial => !opening.units.some(unit => unit.serial === serial && unit.status === 'AVAILABLE'))) stockInvalid();
    if (row.status !== 'RELEASED') for (const serial of row.serials) { if (occupied.has(serial)) stockInvalid(); occupied.set(serial, row); }
    if (row.status === 'RESERVED') reserved += amount;
    if (row.status === 'ISSUED') issued += amount;
    if (row.status === 'CONSUMED') consumed += amount;
    if (['ISSUED', 'CONSUMED'].includes(row.status)) {
      const issue = issues.find(issue => issue._id === row.issueId);
      if (!issue || seenIssues.has(issue._id) || hash(stockHashless(issue)) !== issue.contentHash || issue.contentHash !== row.issueHash || issue.reservationId !== row._id || issue.executionId !== row.executionId || issue.quantity !== row.quantity || hash(issue.serials) !== hash(row.serials) || issue.originHash !== origin.contentHash) stockInvalid(); seenIssues.add(issue._id);
    } else if (row.issueId !== null || row.issueHash !== null) stockInvalid();
    if (row.status === 'CONSUMED') {
      const consumption = consumptions.find(value => value._id === row.consumptionId);
      if (!consumption || seenConsumptions.has(consumption._id) || hash(stockHashless(consumption)) !== consumption.contentHash || consumption.contentHash !== row.consumptionHash || consumption.reservationId !== row._id || consumption.executionId !== row.executionId || consumption.quantity !== row.quantity || hash(consumption.serials) !== hash(row.serials) || consumption.issueId !== row.issueId || consumption.originHash !== origin.contentHash) stockInvalid(); seenConsumptions.add(consumption._id);
    } else if (row.consumptionId !== null || row.consumptionHash !== null) stockInvalid();
  }
  if (issues.length !== seenIssues.size || consumptions.length !== seenConsumptions.size || reserved + issued + consumed > initial || head.reservedQuantity !== stockDecimal(reserved) || head.issuedQuantity !== stockDecimal(issued) || head.consumedQuantity !== stockDecimal(consumed)) stockInvalid();
  return { head, version: head.version, reservations, onHandQuantity: stockDecimal(initial - consumed), reservedQuantity: stockDecimal(reserved), issuedQuantity: stockDecimal(issued), consumedQuantity: stockDecimal(consumed), availableQuantity: stockDecimal(initial - reserved - issued - consumed), units: opening.units.map(unit => { const claim = occupied.get(unit.serial); return { ...unit, openingStatus: unit.status, status: claim ? claim.status : unit.status, ...(claim ? { reservationId: claim._id, executionId: claim.executionId } : {}) }; }) };
}
