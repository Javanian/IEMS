import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const dispositionHash = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
export const dispositionHashless = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'contentHash'));
export const dispositionSemantic = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['eventId', 'authorityHash', 'useFence'].includes(key)));
const hash = dispositionHash, scope = row => ({ tenantId: row.tenantId, plantId: row.plantId });
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
const invalid = () => fail(409, 'CATALOG_DISPOSITION_SOURCE_INVALID');
const positive = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const dispositionUnits = value => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value)) invalid(); return BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0')); };
export const dispositionDecimal = value => { const raw = value.toString().padStart(7, '0'); return `${raw.slice(0, -6)}.${raw.slice(-6)}`.replace(/0+$/, '').replace(/\.$/, ''); };

export function normalizeCatalogInspection(receipt, body, stored = false) {
  const bad = () => { if (stored) invalid(); fail(400, 'INVALID_INSPECTION'); };
  let accepted, rejected;
  try { accepted = dispositionUnits(body.acceptedQuantity); rejected = dispositionUnits(body.rejectedQuantity); } catch { bad(); }
  if (accepted + rejected !== dispositionUnits(receipt.quantity) || typeof body.evidence !== 'string' || body.evidence.trim().length < 3 || body.evidence.trim().length > 2000) bad();
  const result = { acceptedQuantity: dispositionDecimal(accepted), rejectedQuantity: dispositionDecimal(rejected), evidence: body.evidence.trim() };
  if (receipt.catalogSource.trackingPolicy === 'LOT') { if (Object.hasOwn(body, 'acceptedSerials') || Object.hasOwn(body, 'rejectedSerials')) bad(); }
  else {
    const acceptedSerials = body.acceptedSerials, rejectedSerials = body.rejectedSerials;
    if (!Array.isArray(acceptedSerials) || !Array.isArray(rejectedSerials) || acceptedSerials.length + rejectedSerials.length !== receipt.serials.length || accepted !== BigInt(acceptedSerials.length) * 1000000n || rejected !== BigInt(rejectedSerials.length) * 1000000n) bad();
    const all = [...acceptedSerials, ...rejectedSerials];
    if (new Set(all).size !== all.length || all.some(serial => !receipt.serials.includes(serial))) bad();
    result.acceptedSerials = [...acceptedSerials].sort(); result.rejectedSerials = [...rejectedSerials].sort();
  }
  return result;
}

async function locationProof(db, filter, location, owner, session) {
  if (!location || !uuid(location._id) || !positive(location.version) || location.ownerLegalEntityId !== owner || location.status !== 'QUALIFIED' || !location.qualification || !location.binSnapshot || location.binSnapshot._id !== location.binId) invalid();
  const event = await db.collection('internalPlanningEvents').findOne({ ...filter, subjectType: 'LOCATION', subjectId: location._id, version: location.version }, { session });
  if (!event || event.status !== 'QUALIFIED' || event.version !== location.version || hash(event.snapshot) !== event.contentHash || hash({ ...event.snapshot, authorityHash: event.contentHash }) !== hash(location)) invalid();
}

export async function validateCatalogDispositionState(db, receipt, origin, session) {
  const filter = { ...scope(receipt), receiptId: receipt._id }, options = { session };
  const head = await db.collection('catalogDispositionHeads').findOne({ ...scope(receipt), _id: receipt._id }, options);
  const inspections = await db.collection('catalogInspections').find(filter, options).limit(101).toArray();
  const events = await db.collection('catalogDispositionEvents').find(filter, options).limit(103).toArray();
  const balances = await db.collection('catalogStockBalances').find(filter, options).limit(2).toArray();
  const units = await db.collection('catalogStockUnits').find(filter, options).limit(101).toArray();
  const movements = await db.collection('catalogStockMovements').find(filter, options).limit(2).toArray();
  if (await db.collection('warehouseMovements').findOne({ ...filter, kind: { $ne: 'RECEIVE' } }, options) || await db.collection('warehouseReservations').findOne(filter, options) || await db.collection('manufacturingMovements').findOne(filter, options) || await db.collection('serialCustodyUnits').findOne(filter, options) || await db.collection('serialCustodyClaims').findOne(filter, options)) invalid();
  if (!head) {
    if (await db.collection('catalogDispositionHeads').findOne(filter, options)) invalid();
    if (Object.hasOwn(receipt, 'catalogDisposition') || receipt.status !== 'QUARANTINED' || inspections.length || events.length || balances.length || units.length || movements.length) invalid();
    for (const name of ['catalogDispositionKeys', 'catalogDispositionAudit', 'catalogDispositionOutbox']) if (await db.collection(name).findOne(filter, options)) invalid();
    return { head: null, inspection: null, balance: null, units: [], movement: null };
  }
  if (head.receiptId !== receipt._id || head.originHash !== origin.contentHash || !positive(head.version) || head.version < 2 || !positive(head.currentRevision) || head.currentRevision > 100 || !['DRAFT', 'APPROVED', 'STORED'].includes(head.status) || inspections.length !== head.currentRevision || events.length !== head.version - 1 || hash(receipt.catalogDisposition) !== hash({ headId: head._id, version: head.version, authorityHash: head.authorityHash })) invalid();
  const currentEvent = events.find(event => event._id === head.eventId);
  if (!currentEvent || currentEvent.version !== head.version || currentEvent.status !== head.status || currentEvent.contentHash !== head.authorityHash || hash(currentEvent.snapshot) !== head.authorityHash || hash(dispositionSemantic(head)) !== head.authorityHash) invalid();
  const versions = events.map(event => event.version).sort((a, b) => a - b);
  if (versions.some((value, index) => value !== index + 2)) invalid();
  for (const event of events) if (hash(event.snapshot) !== event.contentHash || event.snapshot.receiptId !== receipt._id || event.snapshot.originHash !== origin.contentHash || event.snapshot.version !== event.version || event.snapshot.status !== event.status) invalid();
  for (const inspection of inspections) {
    if (inspection.originHash !== origin.contentHash || !positive(inspection.revision) || inspection.revision > head.currentRevision || hash(dispositionHashless(inspection)) !== inspection.contentHash || hash(normalizeCatalogInspection(receipt, inspection.content, true)) !== hash(inspection.content) || !uuid(inspection.recordedBy) || !inspection.recordedAt) invalid();
  }
  if (new Set(inspections.map(row => row.revision)).size !== inspections.length) invalid();
  const inspection = inspections.find(row => row.revision === head.currentRevision);
  if (!inspection || inspection.contentHash !== head.inspectionHash || hash(inspection.content) !== hash(head.content)) invalid();
  const accepted = dispositionUnits(inspection.content.acceptedQuantity), approved = head.status !== 'DRAFT';
  const expectedStatus = head.status === 'STORED' ? 'CATALOG_STORED' : approved ? accepted > 0n ? 'CATALOG_QC_APPROVED' : 'CATALOG_REJECTED' : 'QUARANTINED';
  if (receipt.status !== expectedStatus) invalid();
  if (!approved) {
    if (head.approval !== null || head.balanceHash !== null || !Array.isArray(head.unitHashes) || head.unitHashes.length || head.putaway !== null || balances.length || units.length || movements.length || head.version !== head.currentRevision + 1) invalid();
    return { head, inspection, balance: null, units: [], movement: null };
  }
  if (!head.approval || head.approval.revision !== inspection.revision || head.approval.contentHash !== inspection.contentHash || !uuid(head.approval.approvedBy) || !head.approval.approvedAt || head.version !== head.currentRevision + (head.status === 'STORED' ? 3 : 2) || balances.length !== 1 || !Array.isArray(head.unitHashes)) invalid();
  const balance = balances[0], source = origin.source, stored = head.status === 'STORED';
  if (!uuid(balance._id) || hash(dispositionHashless(balance)) !== balance.contentHash || balance.contentHash !== head.balanceHash || balance.originHash !== origin.contentHash || balance.inspectionRevision !== inspection.revision || balance.inspectionHash !== inspection.contentHash || balance.ownerLegalEntityId !== source.ownerLegalEntityId || balance.itemId !== source.itemId || balance.itemRevision !== source.itemRevision || balance.uom !== source.uom || balance.trackingPolicy !== source.trackingPolicy || balance.version !== (stored ? 2 : 1) || balance.receivedQuantity !== dispositionDecimal(dispositionUnits(receipt.quantity)) || balance.acceptedQuantity !== inspection.content.acceptedQuantity || balance.rejectedQuantity !== inspection.content.rejectedQuantity || balance.acceptedPendingQuantity !== (stored ? '0' : balance.acceptedQuantity) || balance.storedQuantity !== (stored ? balance.acceptedQuantity : '0') || balance.availableQuantity !== balance.storedQuantity) invalid();
  const registry = await db.collection('warehouseSerials').find({ ...scope(receipt), receiptId: receipt._id }, options).limit(101).toArray();
  if (source.trackingPolicy === 'LOT' ? units.length !== 0 || head.unitHashes.length !== 0 : units.length !== receipt.serials.length || registry.length !== units.length || head.unitHashes.length !== units.length) invalid();
  if (new Set(head.unitHashes.map(row => row.unitId)).size !== head.unitHashes.length || new Set(units.map(row => row.serial)).size !== units.length) invalid();
  for (const unit of units) {
    const pointer = head.unitHashes.find(row => row.unitId === unit._id), identity = registry.find(row => row._id === unit.registryId), good = inspection.content.acceptedSerials.includes(unit.serial);
    if (!pointer || !identity || identity.serial !== unit.serial || !uuid(unit._id) || hash(dispositionHashless(unit)) !== unit.contentHash || pointer.contentHash !== unit.contentHash || unit.originHash !== origin.contentHash || unit.inspectionRevision !== inspection.revision || unit.inspectionHash !== inspection.contentHash || unit.ownerLegalEntityId !== source.ownerLegalEntityId || unit.itemId !== source.itemId || unit.itemRevision !== source.itemRevision || unit.uom !== source.uom || unit.status !== (good ? stored ? 'AVAILABLE' : 'ACCEPTED_QUARANTINE' : 'REJECTED_QUARANTINE') || unit.version !== (good && stored ? 2 : 1) || hash(unit.locationSnapshot) !== hash(good && stored ? balance.locationSnapshot : null)) invalid();
  }
  let movement = null;
  if (stored) {
    if (accepted <= 0n || movements.length !== 1 || !head.putaway || !balance.locationSnapshot) invalid();
    movement = movements[0];
    if (!uuid(movement._id) || hash(dispositionHashless(movement)) !== movement.contentHash || head.putaway.movementId !== movement._id || head.putaway.contentHash !== movement.contentHash || movement.originHash !== origin.contentHash || movement.kind !== 'PUTAWAY' || movement.inspectionRevision !== inspection.revision || movement.inspectionHash !== inspection.contentHash || movement.quantity !== balance.acceptedQuantity || hash(movement.serials) !== hash(inspection.content.acceptedSerials || []) || hash(movement.locationSnapshot) !== hash(balance.locationSnapshot) || hash(head.putaway.locationSnapshot) !== hash(balance.locationSnapshot) || movement.recordedBy !== head.putaway.storedBy || hash(movement.recordedAt) !== hash(head.putaway.storedAt) || !uuid(movement.recordedBy) || !movement.recordedAt) invalid();
    await locationProof(db, scope(receipt), balance.locationSnapshot, source.ownerLegalEntityId, session);
  } else if (movements.length || head.putaway !== null || balance.locationSnapshot !== null) invalid();
  return { head, inspection, balance, units, movement };
}
