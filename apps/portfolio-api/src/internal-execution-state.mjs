import { stockHash as hash, stockHashless as hashless, stockSemantic as semantic, stockUnits as units } from './catalog-stock-use-state.mjs';

export const executionInvalid = () => { throw Object.assign(new Error('INTERNAL_EXECUTION_SOURCE_INVALID'), { status: 409, code: 'INTERNAL_EXECUTION_SOURCE_INVALID' }); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const scope = row => ({ tenantId: row.tenantId, plantId: row.plantId });
const partition = (head, rows) => { const all = [...head.qc.acceptedSerials, ...head.qc.rejectedSerials]; return all.length === rows.length && new Set(all).size === all.length && all.every(serial => rows.some(unit => unit.serial === serial)); };
export async function validateInternalExecution(db, filter, executionId, session) {
  const head = await db.collection('internalExecutions').findOne({ ...filter, _id: executionId }, { session });
  if (!head) throw Object.assign(new Error('NOT_FOUND'), { status: 404, code: 'NOT_FOUND' });
  const options = { session }, event = await db.collection('internalExecutionEvents').findOne({ ...filter, _id: head.eventId, executionId }, options);
  if (!positive(head.version) || head.schema !== 'INTERNAL_EXECUTION_V1' || !['PLANNED', 'RELEASED', 'ISSUED', 'IN_PROGRESS', 'QUARANTINED', 'QC_RELEASED', 'STORED'].includes(head.status) || !event || event.version !== head.version || event.contentHash !== head.authorityHash || hash(event.snapshot) !== head.authorityHash || hash(semantic(head)) !== head.authorityHash || head.sourceDemand._id !== head.internalOrderId || head.sourceDemand.ownerLegalEntityId !== head.ownerLegalEntityId || head.quantity !== head.sourceDemand.quantity || head.uom !== head.sourceDemand.itemSnapshot.content.uom || hash(head.materials) !== hash(head.sourceDemand.engineering.content.materials) || hash(head.operations) !== hash(head.sourceDemand.engineering.content.operations)) executionInvalid();
  const sourceEvent = await db.collection('internalPlanningEvents').findOne({ ...filter, subjectType: 'ORDER', subjectId: head.internalOrderId, version: head.sourceDemand.version }, options), sourceRevision = await db.collection('internalEngineeringRevisions').findOne({ ...filter, subjectId: head.internalOrderId, revision: head.sourceDemand.engineering.currentRevision }, options);
  if (sourceRevision && (hash(Object.fromEntries(['_id', 'tenantId', 'plantId', 'ownerLegalEntityId', 'subjectId', 'revision', 'content', 'reason', 'recordedBy', 'recordedAt'].map(key => [key, sourceRevision[key]]))) !== sourceRevision.contentHash || sourceRevision.ownerLegalEntityId !== head.ownerLegalEntityId || sourceRevision.subjectId !== head.internalOrderId || sourceRevision.revision !== head.sourceDemand.engineering.currentRevision)) executionInvalid();
  if (!sourceEvent || sourceEvent.contentHash !== head.sourceDemand.authorityHash || hash(sourceEvent.snapshot) !== sourceEvent.contentHash || hash({ ...sourceEvent.snapshot, authorityHash: sourceEvent.contentHash }) !== hash(head.sourceDemand) || !sourceRevision || sourceRevision.contentHash !== head.sourceDemand.engineering.contentHash || hash(sourceRevision.content) !== hash(head.sourceDemand.engineering.content)) executionInvalid();
  const reservations = await db.collection('catalogMaterialReservations').find({ ...filter, executionId }, options).limit(21).toArray();
  if (!Array.isArray(head.reservations) || head.reservations.length !== reservations.length || reservations.length > 20 || new Set(head.reservations.map(ref => ref.reservationId)).size !== head.reservations.length || new Set(head.sourceReceiptIds).size !== head.sourceReceiptIds.length || hash([...head.sourceReceiptIds].sort()) !== hash([...new Set(reservations.map(row => row.receiptId))].sort())) executionInvalid();
  for (const row of reservations) { const ref = head.reservations.find(ref => ref.reservationId === row._id), material = head.materials.find(material => material.lineId === row.materialLineId); if (!ref || ref.version !== row.version || ref.contentHash !== row.contentHash || hash(hashless(row)) !== row.contentHash || !material || row.itemId !== material.itemId || row.itemRevision !== material.itemRevision || row.uom !== material.uom || row.ownerLegalEntityId !== head.ownerLegalEntityId) executionInvalid(); }
  if (head.status !== 'PLANNED') for (const material of head.materials) { const own = reservations.filter(row => row.materialLineId === material.lineId && row.status !== 'RELEASED'); if (own.reduce((sum, row) => sum + units(row.quantity), 0n) !== units(material.requiredQuantity)) executionInvalid(); }
  const requiredStatus = ['ISSUED', 'IN_PROGRESS', 'QUARANTINED', 'QC_RELEASED', 'STORED'].includes(head.status) ? head.records.length ? 'CONSUMED' : 'ISSUED' : 'RESERVED';
  if (head.status !== 'PLANNED' && reservations.some(row => row.status !== 'RELEASED' && row.status !== requiredStatus)) executionInvalid();
  if (!Array.isArray(head.records) || head.records.length > head.operations.length || !Array.isArray(head.allocations) || !Array.isArray(head.losses) || !Array.isArray(head.outputHashes)) executionInvalid();
  let previous = units(head.quantity);
  for (let index = 0; index < head.records.length; index++) { const record = head.records[index]; if (record.operationIndex !== index || record.code !== head.operations[index].code || units(record.inputQuantity) !== previous || units(record.goodQuantity) + units(record.scrapQuantity) !== previous || typeof record.evidence !== 'string' || record.evidence.length < 3) executionInvalid(); units(record.laborMinutes); units(record.machineMinutes); previous = units(record.goodQuantity); }
  const outputs = await db.collection('internalOutputUnits').find({ ...filter, executionId }, options).limit(101).toArray();
  const final = head.records.length === head.operations.length;
  if (head.outputHashes.length !== outputs.length || outputs.length > 100 || (final ? previous !== BigInt(outputs.length) * 1000000n : outputs.length !== 0) || new Set(outputs.map(row => row.serial)).size !== outputs.length || new Set(head.outputHashes.map(row => row.unitId)).size !== outputs.length) executionInvalid();
  if (!final && ['QUARANTINED', 'QC_RELEASED', 'STORED'].includes(head.status)) executionInvalid();
  if (final && !['QUARANTINED', 'QC_RELEASED', 'STORED'].includes(head.status)) executionInvalid();
  if (head.qc && (!Array.isArray(head.qc.acceptedSerials) || !Array.isArray(head.qc.rejectedSerials) || !partition(head, outputs))) executionInvalid();
  for (const output of outputs) {
    const ref = head.outputHashes.find(ref => ref.unitId === output._id), registry = await db.collection('warehouseSerials').findOne({ ...filter, serial: output.serial }, options), accepted = head.qc?.acceptedSerials.includes(output.serial), status = head.qc ? accepted ? head.status === 'STORED' ? 'STORED' : 'ACCEPTED' : 'REJECTED' : 'QUARANTINED';
    if (!ref || hash(hashless(output)) !== output.contentHash || ref.contentHash !== output.contentHash || !registry || registry.sourceType !== 'INTERNAL_OUTPUT' || registry.internalExecutionId !== head._id || registry.unitId !== output._id || ['receiptId', 'workOrderId'].some(key => Object.hasOwn(registry, key)) || output.ownerLegalEntityId !== head.ownerLegalEntityId || output.itemId !== head.sourceDemand.itemSnapshot._id || output.itemRevision !== head.sourceDemand.itemSnapshot.currentRevision || output.status !== status || output.version !== (head.qc ? accepted && head.status === 'STORED' ? 3 : 2 : 1)) executionInvalid();
  }
  const attributions = await db.collection('internalAttributionRevisions').find({ ...filter, executionId }, options).limit(501).toArray();
  if (!Number.isSafeInteger(head.attributionRevision) || head.attributionRevision < 0 || head.attributionRevision > 500 || attributions.length !== head.attributionRevision) executionInvalid();
  for (const row of attributions) if (hash(hashless(row)) !== row.contentHash) executionInvalid();
  if (head.attributionRevision) { const current = attributions.find(row => row.revision === head.attributionRevision); if (!current || current.contentHash !== head.attributionHash || hash(current.allocations) !== hash(head.allocations) || hash(current.losses) !== hash(head.losses)) executionInvalid(); }
  else if (head.attributionHash !== null || head.allocations.length || head.losses.length) executionInvalid();
  const companyRows = await db.collection('internalCompanyStockReceipts').find({ ...filter, executionId }, options).limit(2).toArray(), companyUnits = await db.collection('internalCompanyStockUnits').find({ ...filter, executionId }, options).limit(101).toArray();
  if (head.status === 'STORED') {
    const company = companyRows[0];
    const consumedReceiptIds = reservations.filter(row => row.status === 'CONSUMED').map(row => row.receiptId).sort();
    if (companyRows.length !== 1 || !head.companyStock || hash(hashless(company)) !== company.contentHash || company.contentHash !== head.companyStock.contentHash || company._id !== head.companyStock.receiptId || company.quantity !== String(head.qc.acceptedSerials.length) || hash([...company.serials].sort()) !== hash([...head.qc.acceptedSerials].sort()) || companyUnits.length !== head.qc.acceptedSerials.length || company.valuation !== 'UNVALUED') executionInvalid();
    if (!Array.isArray(head.companyStock.unitHashes) || head.companyStock.unitHashes.length !== companyUnits.length || new Set(head.companyStock.unitHashes.map(ref => ref.unitId)).size !== companyUnits.length || new Set(companyUnits.map(unit => unit.outputUnitId)).size !== companyUnits.length || new Set(companyUnits.map(unit => unit.serial)).size !== companyUnits.length || company.itemId !== head.sourceDemand.itemSnapshot._id || company.itemRevision !== head.sourceDemand.itemSnapshot.currentRevision || company.uom !== head.uom || company.ownerLegalEntityId !== head.ownerLegalEntityId || hash(company.sourceReceiptIds) !== hash(head.sourceReceiptIds) || hash(company.consumedReceiptIds) !== hash(consumedReceiptIds) || company.provenanceHash !== head.attributionHash || hash(company.qc) !== hash(head.qc)) executionInvalid();
    for (const unit of companyUnits) {
      const ref = head.companyStock.unitHashes.find(ref => ref.unitId === unit._id), output = outputs.find(output => output._id === unit.outputUnitId);
      if (!ref || ref.contentHash !== unit.contentHash || hash(hashless(unit)) !== unit.contentHash || !output || output.serial !== unit.serial || !head.qc.acceptedSerials.includes(output.serial) || unit.itemId !== company.itemId || unit.itemRevision !== company.itemRevision || unit.uom !== company.uom || hash(unit.sourceReceiptIds) !== hash(head.sourceReceiptIds) || hash(unit.consumedReceiptIds) !== hash(consumedReceiptIds) || unit.companyReceiptId !== company._id || !company.serials.includes(unit.serial) || unit.status !== 'AVAILABLE' || unit.ownerLegalEntityId !== head.ownerLegalEntityId || hash(unit.locationSnapshot) !== hash(company.locationSnapshot)) executionInvalid();
    }
  } else if (head.companyStock !== null || companyRows.length || companyUnits.length) executionInvalid();
  return { head, reservations, outputs, companyReceipt: companyRows[0] || null, companyUnits };
}

export function reconcileInternalAttribution(head, reservations, outputs, complete = false) {
  const consumed = reservations.filter(row => row.status === 'CONSUMED'), seenSerials = new Set(), totals = new Map(consumed.map(row => [row.receiptId, 0n]));
  if (new Set(head.allocations.map(row => row.outputUnitId)).size !== head.allocations.length || head.allocations.some(row => !outputs.some(output => output._id === row.outputUnitId))) executionInvalid();
  const addSources = (sources, perOutput) => {
    if (!Array.isArray(sources) || sources.length > 20 || new Set(sources.map(row => row.receiptId)).size !== sources.length) executionInvalid();
    for (const source of sources) {
      const reservation = consumed.find(row => row.receiptId === source.receiptId), quantity = units(source.quantity);
      if (!reservation || quantity <= 0n) executionInvalid();
      const policy = reservation.sourceSnapshot.trackingPolicy, serials = source.serials;
      if (policy === 'LOT' ? Object.hasOwn(source, 'serials') : !Array.isArray(serials) || quantity !== BigInt(serials.length) * 1000000n || serials.some(serial => !reservation.serials.includes(serial))) executionInvalid();
      for (const serial of serials || []) { if (seenSerials.has(serial)) executionInvalid(); seenSerials.add(serial); }
      totals.set(source.receiptId, totals.get(source.receiptId) + quantity);
    }
    if (perOutput) for (const material of head.materials) { const own = sources.filter(source => consumed.find(row => row.receiptId === source.receiptId)?.materialLineId === material.lineId), total = own.reduce((sum, source) => sum + units(source.quantity), 0n); if (complete ? total !== units(material.quantityPerUnit) : total > units(material.quantityPerUnit)) executionInvalid(); }
  };
  for (const allocation of head.allocations) addSources(allocation.sources, true); addSources(head.losses, false);
  for (const reservation of consumed) if (complete ? totals.get(reservation.receiptId) !== units(reservation.quantity) : totals.get(reservation.receiptId) > units(reservation.quantity)) executionInvalid();
  if (complete && (head.allocations.length !== outputs.length || consumed.some(row => row.sourceSnapshot.trackingPolicy === 'SERIAL' && row.serials.some(serial => !seenSerials.has(serial))))) executionInvalid();
  return true;
}
