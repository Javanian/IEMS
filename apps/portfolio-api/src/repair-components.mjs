import { randomUUID } from 'node:crypto';
import { qualityText } from './quality.mjs';
import { domainError as fail } from '../../../packages/contracts/src/domains/engineering-repair/gates.mjs';

export async function initializeRepairComponents(db) {
  await db.collection('repairRemovedComponents').createIndex({ tenantId: 1, plantId: 1, caseId: 1, component: 1 }, { unique: true });
  await db.collection('repairComponentRevisions').createIndex({ tenantId: 1, plantId: 1, componentId: 1, version: 1 }, { unique: true });
  await db.collection('repairReplacementRemovals').createIndex({ tenantId: 1, plantId: 1, sourceReplacementId: 1 }, { unique: true });
}
export async function recordComponentCustody(db, filter, row, action, body, actor, session, now) {
  if (!session?.inTransaction()) throw new Error('ACTIVE_CALLER_TRANSACTION_REQUIRED');
  if (row.decision?.decision !== 'ACCEPT' || !row.scopes?.length) fail(409, 'REPAIR_SCOPE_REQUIRED');
  const evidence = { evidence: qualityText(body.evidence), recordedBy: actor, recordedAt: now };
  let component, collection = 'repairRemovedComponents';
  if (action === 'component-remove') {
    if (!['IN_PROGRESS', 'REWORK'].includes(row.status) || row.holdActive) fail(409, 'STATE_CONFLICT');
    const name = qualityText(body.component), finding = row.scopes.at(-1).findings.find(f => f.component === name);
    if (!finding || !(['REPLACE', 'SCRAP'].includes(finding.disposition) || row.status === 'REWORK' && finding.disposition === 'REPAIR' && row.spareMaterials?.some(m => m.component === name && m.cycle === row.tests.at(-1)?.run))) fail(409, 'COMPONENT_REMOVAL_NOT_AUTHORIZED');
    if ((row.componentRemovals?.length || 0) >= 100) fail(409, 'COMPONENT_HISTORY_LIMIT');
    const replacement = row.replacements?.findLast(r => r.component === name && !row.componentRemovals?.some(c => c.sourceReplacementId === r._id));
    if (row.componentRemovals?.some(c => c.component === name) && !replacement) fail(409, 'COMPONENT_ALREADY_REMOVED');
    if (row.replacementFreeze) fail(409, 'REPAIR_SCOPE_CLOSED');
    if (replacement && replacement.serials.length && (replacement.serials.length !== 1 || replacement.serials[0] !== body.serial)) fail(409, 'COMPONENT_SERIAL_CONFLICT');
    if (replacement) collection = 'repairReplacementRemovals';
    component = { _id: randomUUID(), ...filter, schema: 'REPAIR_REMOVED_COMPONENT_V1', version: 1, caseId: row._id, caseNumber: row.caseNumber, ownerAccountId: row.ownerAccountId, parentSerial: row.serial, component: name, serial: qualityText(body.serial), condition: qualityText(body.condition), status: 'QUARANTINED', scopeRevision: row.decision.revision, authorizedDisposition: finding.disposition, removed: evidence, origin: replacement ? 'INSTALLED_REPLACEMENT' : 'CUSTOMER_COMPONENT', ...(replacement ? { sourceReplacementId: replacement._id, sourceReplacement: structuredClone(replacement) } : {}) };
    await db.collection(collection).insertOne(component, { session });
  } else {
    const reference = row.componentRemovals?.find(c => c.componentId === body.componentId);
    if (!reference) fail(404, 'NOT_FOUND');
    if (reference.sourceReplacementId) collection = 'repairReplacementRemovals';
    component = await db.collection(collection).findOne({ ...filter, _id: reference.componentId, caseId: row._id }, { session });
    if (!component || component.version !== reference.version || component.status !== 'QUARANTINED' || row.holdActive) fail(409, 'COMPONENT_CUSTODY_CONFLICT');
    if (!['RETURN_TO_CUSTOMER', 'SCRAP'].includes(body.disposition)) fail(400, 'INVALID_COMPONENT_DISPOSITION');
    if (body.disposition === 'SCRAP' && component.authorizedDisposition !== 'SCRAP') fail(409, 'COMPONENT_SCRAP_NOT_AUTHORIZED');
    const previous = component.version;
    component.status = body.disposition === 'SCRAP' ? 'SCRAPPED' : 'RETURNED_TO_CUSTOMER'; component.disposed = evidence; component.version++;
    const changed = await db.collection(collection).replaceOne({ ...filter, _id: component._id, caseId: row._id, version: previous }, component, { session }); if (changed.matchedCount !== 1) fail(409, 'VERSION_CONFLICT');
  }
  await db.collection('repairComponentRevisions').insertOne({ _id: randomUUID(), ...filter, caseId: row._id, componentId: component._id, version: component.version, snapshot: component }, { session });
  const snapshot = { componentId: component._id, component: component.component, serial: component.serial, version: component.version, status: component.status, authorizedDisposition: component.authorizedDisposition, scopeRevision: component.scopeRevision, removed: component.removed, ...(component.sourceReplacementId ? { sourceReplacementId: component.sourceReplacementId } : {}), ...(component.disposed ? { disposed: component.disposed } : {}) };
  row.componentRemovals = [...(row.componentRemovals || []).filter(c => c.componentId !== component._id), snapshot];
  return component;
}
