import { createHash, randomUUID } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const purchaseHash = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
export const purchaseOrderLineIds = row => row.lineIds || row.snapshot.lines.map((_, index) => {
  const raw = purchaseHash([row._id, index]); return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-8${raw.slice(13, 16)}-a${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
});
const fail = code => { throw Object.assign(new Error(code), { status: 409, code }); };
export const purchaseUnits = value => { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value)) fail('INVALID_QUANTITY'); return BigInt(value.split('.')[0]) * 1000000n + BigInt((value.split('.')[1] || '').padEnd(6, '0')); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const recordBody = row => Object.fromEntries(['schema', 'tenantId', 'plantId', 'cohort', 'orderId', 'revision', 'snapshot', 'lineIds', 'previousHash', 'approval', 'reason', 'issuedBy', 'issuedAt'].map(key => [key, row[key]]));
export async function initializePurchaseOrderRevisions(db) {
  await db.collection('purchaseOrderDocumentRevisions').createIndex({ tenantId: 1, plantId: 1, cohort: 1, orderId: 1, revision: 1 }, { unique: true });
  await db.collection('purchaseOrderAmendmentKeys').createIndex({ tenantId: 1, plantId: 1, cohort: 1, key: 1 }, { unique: true });
}
function initialRecord(filter, cohort, row) {
  const snapshot = structuredClone(cohort === 'CATALOG' ? row.content : row.snapshot);
  const lineIds = cohort === 'CATALOG' ? snapshot.lines.map(line => line.lineId) : purchaseOrderLineIds(row);
  const record = { schema: 'PURCHASE_ORDER_APPROVED_REVISION_V1', ...filter, cohort, orderId: row._id, revision: 1, snapshot, lineIds, previousHash: null, approval: row.sourceApproval || { sourceRequestId: row.requestId }, reason: 'Original issued purchase order', issuedBy: row.issuedBy, issuedAt: row.issuedAt };
  return { ...record, contentHash: purchaseHash(recordBody(record)) };
}
export async function readApprovedOrderRevision(db, filter, cohort, row, revision, session) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > (row.documentRevision || 1) || !['ISSUED', 'CONFIRMED'].includes(row.status)) fail('SOURCE_NOT_ISSUED');
  const chain = await db.collection('purchaseOrderDocumentRevisions').find({ ...filter, cohort, orderId: row._id, revision: { $lte: revision } }, { session }).sort({ revision: 1 }).limit(101).toArray();
  if (!chain.length && revision === 1 && (row.documentRevision || 1) === 1) return initialRecord(filter, cohort, row);
  if (chain.length !== revision) fail('PO_REVISION_INTEGRITY');
  let previousHash = null;
  for (let index = 0; index < chain.length; index++) {
    const record = chain[index];
    if (record.revision !== index + 1 || record.previousHash !== previousHash || record.contentHash !== purchaseHash(recordBody(record))) fail('PO_REVISION_INTEGRITY');
    previousHash = record.contentHash;
  }
  return chain.at(-1);
}
export async function archiveInitialOrderRevision(db, filter, cohort, row, session) {
  const existing = await db.collection('purchaseOrderDocumentRevisions').findOne({ ...filter, cohort, orderId: row._id, revision: 1 }, { session });
  if (existing) return existing;
  if ((row.documentRevision || 1) !== 1) fail('PO_REVISION_INTEGRITY');
  const record = initialRecord(filter, cohort, row);
  await db.collection('purchaseOrderDocumentRevisions').insertOne({ _id: randomUUID(), ...record }, { session });
  return record;
}
export function validateIncreaseOnlyAmendment(original, proposed, originalIds, proposedIds) {
  if (proposed.currency !== original.currency || proposed.taxPolicy !== original.taxPolicy || proposed.roundingPolicy !== original.roundingPolicy || proposed.vendorId !== original.vendorId || proposed.lines.length < original.lines.length) fail('PO_IDENTITY_IMMUTABLE');
  if (proposedIds.length !== proposed.lines.length || new Set(proposedIds).size !== proposedIds.length) fail('INVALID_LINE_ID');
  let changed = proposed.lines.length !== original.lines.length;
  for (let index = 0; index < proposed.lines.length; index++) {
    const line = proposed.lines[index], prior = original.lines[index];
    if (line.retired || purchaseUnits(line.quantity) === 0n) fail('FINANCIAL_COMMITMENT_READER_REQUIRED');
    if (prior) {
      if (proposedIds[index] !== originalIds[index]) fail('PO_IDENTITY_IMMUTABLE');
      for (const key of Object.keys(prior).filter(key => !['quantity', 'unitPrice', 'lineTotal', 'amount'].includes(key))) if (purchaseHash(line[key]) !== purchaseHash(prior[key])) fail('PO_IDENTITY_IMMUTABLE');
      if (purchaseUnits(line.quantity) < purchaseUnits(prior.quantity) || line.unitPrice !== prior.unitPrice) fail('FINANCIAL_COMMITMENT_READER_REQUIRED');
      changed ||= purchaseUnits(line.quantity) !== purchaseUnits(prior.quantity);
    } else if (!uuid(proposedIds[index])) fail('INVALID_LINE_ID');
  }
  if (!changed) fail('NO_AMENDMENT_CHANGE');
}
const amendmentBody = row => Object.fromEntries(['amendmentId', 'orderId', 'baseDocumentRevision', 'snapshot', 'lineIds', 'reason', 'createdBy', 'createdAt'].map(key => [key, row[key]]));
export async function applyOrderAmendment(db, filter, cohort, row, input, actor, operation, amendmentId, build, validateCurrent, session) {
  if (!session?.inTransaction?.()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  if (!['ISSUED', 'CONFIRMED'].includes(row.status)) fail('SOURCE_NOT_ISSUED');
  if (row.version !== input.expectedVersion || (row.documentRevision || 1) !== input.baseDocumentRevision) fail('VERSION_CONFLICT');
  const current = await readApprovedOrderRevision(db, filter, cohort, row, row.documentRevision || 1, session);
  await validateCurrent();
  await archiveInitialOrderRevision(db, filter, cohort, row, session);
  row.amendments ||= [];
  if (operation === 'create') {
    if (row.amendments.length >= 100) fail('AMENDMENT_LIMIT');
    const proposed = await build(input.lines, current);
    validateIncreaseOnlyAmendment(current.snapshot, proposed.snapshot, current.lineIds, proposed.lineIds);
    const draft = { amendmentId: randomUUID(), orderId: row._id, baseDocumentRevision: current.revision, ...proposed, reason: input.reason, createdBy: actor, createdAt: new Date(), status: 'DRAFT' };
    draft.amendmentHash = purchaseHash(amendmentBody(draft)); row.amendments.push(draft);
  } else {
    const draft = row.amendments.find(value => value.amendmentId === amendmentId);
    if (!draft || draft.amendmentHash !== input.amendmentHash || draft.amendmentHash !== purchaseHash(amendmentBody(draft)) || draft.baseDocumentRevision !== current.revision) fail('AMENDMENT_CONFLICT');
    validateIncreaseOnlyAmendment(current.snapshot, draft.snapshot, current.lineIds, draft.lineIds);
    const rebuilt = await build(draft.snapshot.lines.map((line, index) => ({ ...line, lineId: draft.lineIds[index] })), current);
    if (purchaseHash(rebuilt) !== purchaseHash({ snapshot: draft.snapshot, lineIds: draft.lineIds })) fail('AMENDMENT_CONFLICT');
    if (operation === 'approve') {
      if (draft.status !== 'DRAFT') fail('STATE_CONFLICT');
      draft.status = 'APPROVED'; draft.approval = { approvedBy: actor, approvedAt: new Date(), amendmentHash: draft.amendmentHash, reason: input.reason };
    } else {
      if (draft.status !== 'APPROVED' || draft.approval?.amendmentHash !== draft.amendmentHash) fail('NOT_APPROVED');
      const record = { schema: 'PURCHASE_ORDER_APPROVED_REVISION_V1', ...filter, cohort, orderId: row._id, revision: current.revision + 1, snapshot: structuredClone(draft.snapshot), lineIds: [...draft.lineIds], previousHash: current.contentHash, approval: structuredClone(draft.approval), reason: input.reason, issuedBy: actor, issuedAt: new Date() };
      record.contentHash = purchaseHash(recordBody(record));
      await db.collection('purchaseOrderDocumentRevisions').insertOne({ _id: randomUUID(), ...record }, { session });
      row[cohort === 'CATALOG' ? 'content' : 'snapshot'] = structuredClone(record.snapshot); row.lineIds = [...record.lineIds]; row.documentRevision = record.revision;
      if (cohort === 'CATALOG') row.currentRevision = record.revision;
      draft.status = 'ISSUED'; draft.documentRevision = record.revision; draft.issuedAt = record.issuedAt;
    }
  }
  row.version++; row.updatedAt = new Date();
  return row;
}
