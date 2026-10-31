import { requireUnboundSalesOrder } from './quote-catalog.mjs';
import { requireLegacyReceipt } from './receipt-origin.mjs';
import { requireCatalogInventoryItem } from './internal-production.mjs';
import { stockHash, stockSemantic } from './catalog-stock-values.mjs';

const requirementInput = row => Object.fromEntries(['itemId', 'itemVersion', 'itemRevision', 'quantityPerUnit', 'uom'].map(key => [key, row[key]]));
const requirementId = (engineeringId, itemId) => {
  const raw = stockHash([engineeringId, itemId]);
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-8${raw.slice(13,16)}-a${raw.slice(17,20)}-${raw.slice(20,32)}`;
};

export function installEngineering(app, { db, c, find, base, tx, fail, fields, id, qty, text, now = () => new Date() }) {
  const positive = n => { if (!Number.isSafeInteger(n) || n < 1) fail(400, 'INVALID_VERSION'); return n; };
  const revisionNumber = raw => { if (!/^[1-9][0-9]*$/.test(raw)) fail(400, 'INVALID_REVISION'); return positive(Number(raw)); };
  const revision = async (req, head, number, session) => {
    const row = await c('engineeringRevisions').findOne({ ...req.filter, engineeringId: head._id, revision: number }, { session });
    if (!row) fail(404, 'NOT_FOUND'); return row;
  };
  const source = async (req, head, session) => {
    const so = await find('salesOrders', req, head.salesOrderId, session);
    await requireUnboundSalesOrder(db, req.filter, so, session);
    if (so.version !== head.salesOrderVersion) fail(409, 'VERSION_CONFLICT');
    if (so.status !== 'OPEN') fail(409, 'STATE_CONFLICT');
    if (!Number.isSafeInteger(head.lineIndex) || head.lineIndex < 0 || !so.snapshot.lines[head.lineIndex]) fail(400, 'INVALID_LINE');
    if (so.snapshot.lines[head.lineIndex].uom !== head.uom) fail(409, 'UOM_CONFLICT');
  };
  const content = async (req, body, session, head) => {
    const requirements = body.purchasedMaterials;
    if (requirements !== undefined && (!Array.isArray(requirements) || !requirements.length || requirements.length > 20)) fail(400, 'INVALID_MATERIAL_DEMAND');
    if (!Array.isArray(body.operations) || !body.operations.length || body.operations.length > 50 || !Array.isArray(body.materials) || (!body.materials.length && !requirements?.length) || body.materials.length > 100) fail(400, 'INVALID_ROUTING');
    if ([...body.operations, ...body.materials].some(v => !v || typeof v !== 'object' || Array.isArray(v))) fail(400, 'INVALID_ROUTING');
    const operations = body.operations.map(op => { fields(op, ['code', 'instruction']); return { code: text(op.code), instruction: text(op.instruction) }; });
    const materials = [];
    for (const m of body.materials) {
      fields(m, ['receiptId', 'quantityPerUnit', 'uom']); id(m.receiptId); qty(m.quantityPerUnit);
      if (typeof m.uom !== 'string' || !/^[A-Z][A-Z0-9_]{0,15}$/.test(m.uom)) fail(400, 'INVALID_UOM');
      const receipt = await find('warehouseReceipts', req, m.receiptId, session);
      await requireLegacyReceipt(db, receipt, session);
      if (receipt.uom !== m.uom) fail(409, 'UOM_CONFLICT');
      materials.push({ receiptId: m.receiptId, quantityPerUnit: m.quantityPerUnit, uom: m.uom });
    }
    if (new Set(operations.map(o => o.code)).size !== operations.length || new Set(materials.map(m => m.receiptId)).size !== materials.length) fail(400, 'INVALID_ROUTING');
    if (!requirements) return { operations, materials };
    const plant = await c('plants').findOne({ tenantId: req.filter.tenantId, _id: req.filter.plantId, active: true }, { session });
    if (!plant || !await c('legalEntities').findOne({ tenantId: req.filter.tenantId, _id: plant.legalEntityId, active: true }, { session })) fail(403, 'SCOPE_DENIED');
    const purchasedMaterials = [];
    for (const entry of requirements) {
      fields(entry, ['itemId', 'itemVersion', 'itemRevision', 'quantityPerUnit', 'uom']);
      id(entry.itemId); positive(entry.itemVersion); positive(entry.itemRevision); qty(entry.quantityPerUnit);
      const item = await requireCatalogInventoryItem(db, req.filter, entry.itemId, entry.itemVersion, entry.itemRevision, session, true);
      if (item.ownerLegalEntityId !== plant.legalEntityId || item.content.uom !== entry.uom) fail(409, 'MATERIAL_SOURCE_CONFLICT');
      purchasedMaterials.push({ ...requirementInput(entry), lineId: requirementId(head._id, item._id),
        sourceKind: 'CATALOG_RECEIPT', itemSnapshot: { ...stockSemantic(item), authorityHash: item.authorityHash } });
    }
    if (new Set(purchasedMaterials.map(entry => entry.itemId)).size !== purchasedMaterials.length) fail(400, 'INVALID_MATERIAL_DEMAND');
    return { operations, materials, purchasedMaterials, purchasedMaterialsHash: stockHash(purchasedMaterials) };
  };
  app.get('/api/manufacturing/engineering', async (req, res) => {
    const limit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
    const filter = { ...req.filter }; if (req.query.cursor !== undefined) filter._id = { $gt: id(req.query.cursor) };
    const rows = await c('engineeringPackages').find(filter).sort({ _id: 1 }).limit(limit + 1).toArray(), data = rows.slice(0, limit);
    res.json({ data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null } });
  });
  app.get('/api/manufacturing/engineering/:id', async (req, res) => res.json({ data: await find('engineeringPackages', req, req.params.id) }));
  app.get('/api/manufacturing/engineering/:id/revisions/:revision', async (req, res) => {
    const head = await find('engineeringPackages', req, req.params.id);
    res.json({ data: await revision(req, head, revisionNumber(req.params.revision)) });
  });
  app.post('/api/manufacturing/engineering', async (req, res) => {
    fields(req.body, ['expectedVersion', 'idempotencyKey', 'salesOrderId', 'salesOrderVersion', 'lineIndex', 'uom', 'operations', 'materials', 'purchasedMaterials']);
    const b = req.body;
    const data = await tx(req, 'engineering.draft', async session => {
      if (b.expectedVersion !== 1) fail(409, 'VERSION_CONFLICT'); positive(b.salesOrderVersion);
      const head = { ...base(req), salesOrderId: id(b.salesOrderId), salesOrderVersion: b.salesOrderVersion, lineIndex: b.lineIndex, uom: b.uom, currentRevision: 1, status: 'DRAFT' };
      await source(req, head, session);
      const body = await content(req, b, session, head);
      await c('engineeringPackages').insertOne(head, { session });
      await c('engineeringRevisions').insertOne({ ...base(req), engineeringId: head._id, revision: 1, ...body }, { session });
      return head;
    }); res.status(201).json({ data });
  });
  for (const action of ['revisions', 'release', 'revoke']) app.post(`/api/manufacturing/engineering/:id/${action}`, async (req, res) => {
    const b = req.body;
    fields(b, ['expectedVersion', 'idempotencyKey', ...(action === 'revisions' ? ['operations', 'materials', 'purchasedMaterials'] : action === 'revoke' ? ['revision', 'reason'] : ['revision'])]);
    if (action !== 'revisions') positive(b.revision);
    if (action === 'revoke') text(b.reason);
    const data = await tx(req, `engineering.${action}`, async session => {
      const head = await find('engineeringPackages', req, req.params.id, session);
      if (head.version !== b.expectedVersion) fail(409, 'VERSION_CONFLICT');
      if (action === 'revisions') {
        if (head.currentRevision >= 100) fail(409, 'REVISION_LIMIT');
        const prior = await revision(req, head, head.currentRevision, session);
        const input = b.purchasedMaterials === undefined && prior.purchasedMaterials ? { ...b, purchasedMaterials: prior.purchasedMaterials.map(requirementInput) } : b;
        const body = await content(req, input, session, head);
        head.currentRevision++; head.status = 'DRAFT'; delete head.revocation;
        await c('engineeringRevisions').insertOne({ ...base(req), engineeringId: head._id, revision: head.currentRevision, ...body }, { session });
      } else {
        if (b.revision !== head.currentRevision) fail(409, 'REVISION_CONFLICT');
        if (head.status !== (action === 'release' ? 'DRAFT' : 'RELEASED')) fail(409, 'STATE_CONFLICT');
        if (action === 'release') {
          await source(req, head, session);
          const rev = await revision(req, head, b.revision, session);
          const checked = await content(req, { ...rev, ...(rev.purchasedMaterials ? { purchasedMaterials: rev.purchasedMaterials.map(requirementInput) } : {}) }, session, head);
          if (rev.purchasedMaterials && (stockHash(rev.purchasedMaterials) !== rev.purchasedMaterialsHash || checked.purchasedMaterialsHash !== rev.purchasedMaterialsHash)) fail(409, 'MATERIAL_DEMAND_CHANGED');
          const releaseSnapshot = { operations: rev.operations, materials: rev.materials, ...(rev.purchasedMaterials ? { purchasedMaterials: rev.purchasedMaterials, purchasedMaterialsHash: rev.purchasedMaterialsHash } : {}), releasedBy: req.scope.userId, releasedAt: now(), releaseRecordedAt: new Date() };
          await c('engineeringRevisions').updateOne({ ...req.filter, _id: rev._id }, { $set: { releaseSnapshot } }, { session });
          head.status = 'RELEASED';
        } else { head.status = 'REVOKED'; head.revocation = { revision: b.revision, reason: text(b.reason), revokedBy: req.scope.userId, revokedAt: new Date() }; }
      }
      head.version++; head.updatedAt = new Date();
      const saved = await c('engineeringPackages').replaceOne({ ...req.filter, _id: head._id, version: b.expectedVersion }, head, { session });
      if (!saved.matchedCount) fail(409, 'VERSION_CONFLICT'); return head;
    }); res.json({ data });
  });
  return async (req, wo, session) => {
    const b = req.body; positive(b.engineeringVersion); positive(b.revision);
    const head = await find('engineeringPackages', req, b.engineeringId, session);
    if (head.version !== b.engineeringVersion) fail(409, 'VERSION_CONFLICT');
    if (head.currentRevision !== b.revision) fail(409, 'REVISION_CONFLICT');
    if (head.status !== 'RELEASED') fail(409, 'STATE_CONFLICT');
    if (head.salesOrderId !== wo.salesOrderId || head.salesOrderVersion !== wo.salesOrderVersion || head.lineIndex !== wo.lineIndex || head.uom !== wo.uom) fail(409, 'SOURCE_CONFLICT');
    await source(req, head, session);
    // Serialize use with revocation/revision without advancing the public engineering version.
    const fenced = await c('engineeringPackages').updateOne({ ...req.filter, _id: head._id, version: head.version, status: 'RELEASED' }, { $inc: { useFence: 1 } }, { session });
    if (!fenced.matchedCount) fail(409, 'VERSION_CONFLICT');
    const rev = await revision(req, head, b.revision, session);
    if (!rev.releaseSnapshot) fail(409, 'STATE_CONFLICT');
    wo.engineeringSnapshot = { engineeringId: head._id, engineeringVersion: head.version, revision: b.revision, releaseSnapshot: rev.releaseSnapshot };
    return rev.releaseSnapshot;
  };
}
