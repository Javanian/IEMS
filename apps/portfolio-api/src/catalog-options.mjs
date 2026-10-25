import { requireCatalogInventoryItem } from './internal-production.mjs';
import { isDeepStrictEqual } from 'node:util';
import { catalogOptionCollection, catalogOptionPrefixIndex, catalogOptionProjection, initializeCatalogOptionIndex, normalizeCatalogSearch } from './catalog-option-index.mjs';

const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
export const catalogOptionIndexes = { items: catalogOptionPrefixIndex, vendors: catalogOptionPrefixIndex };
export function catalogOptionQuery(filter, type, ownerLegalEntityId, q, cursor) {
  return { ...filter, type, ownerLegalEntityId: type === 'items' ? ownerLegalEntityId : null, eligible: true, prefixes: normalizeCatalogSearch(q), ...(cursor ? { _id: { $gt: cursor } } : {}) };
}
export async function initializeCatalogOptions(db) {
  await initializeCatalogOptionIndex(db);
}
export function installCatalogOptions(app, runtime, { read, owner, id }) {
  const db = runtime.db, root = '/api/catalog-procurement/options';
  const rowView = async (req, type, row, session, ownerLegalEntityId) => {
    if (type === 'vendors') {
      if (typeof row.name !== 'string' || !row.name.trim() || !Number.isSafeInteger(row.version) || row.version < 1 || (Object.hasOwn(row, 'active') && ![true, false].includes(row.active))) fail(409, 'CATALOG_SOURCE_INVALID');
      return { _id: row._id, name: row.name, version: row.version, eligible: !Object.hasOwn(row, 'active') || row.active === true, blockers: row.active === false ? ['VENDOR_INACTIVE'] : [] };
    }
    const blockers = [];
    try { await requireCatalogInventoryItem(db, req.filter, row._id, row.version, row.currentRevision, session); }
    catch (error) { if (error.code !== 'CATALOG_DEPENDENCY_CHANGED') throw error; if (row.status !== 'APPROVED') blockers.push('ITEM_NOT_APPROVED'); if (row.content.kind !== 'PURCHASED') blockers.push('ITEM_NOT_PURCHASED'); if (row.content.schema !== 'INVENTORY_ITEM_V2' || !['LOT', 'SERIAL'].includes(row.content.trackingPolicy)) blockers.push('TRACKING_POLICY_REQUIRED'); }
    if (row.ownerLegalEntityId !== ownerLegalEntityId) fail(404, 'NOT_FOUND');
    return { _id: row._id, code: row.code, content: row.content, currentRevision: row.currentRevision, version: row.version, ownerLegalEntityId: row.ownerLegalEntityId, eligible: blockers.length === 0, blockers };
  };
  for (const type of ['items', 'vendors']) {
    const path = `${root}/${type}`, name = type === 'items' ? 'inventoryItems' : 'vendors', eligibility = type === 'items' ? 'PURCHASED_V2_APPROVED' : 'ACTIVE_VENDOR';
    const authorize = req => runtime.foundation.authorize(req.scope, { ...req.filter, action: type === 'items' ? 'master.read' : 'procurement.read' });
    app.get(path, async (req, res) => {
      await authorize(req);
      if (Object.keys(req.query).some(key => !['q', 'eligibility', 'limit', 'cursor'].includes(key)) || req.query.eligibility !== eligibility || (req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.trim().length > 80))) fail(400, 'INVALID_SEARCH');
      const q = (req.query.q || '').trim(), limit = req.query.limit === undefined ? 25 : Number(req.query.limit), cursor = req.query.cursor === undefined ? null : id(req.query.cursor);
      if (normalizeCatalogSearch(q).length > 80) fail(400, 'INVALID_SEARCH');
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit !== undefined && !/^[0-9]+$/.test(req.query.limit))) fail(400, 'INVALID_PAGINATION');
      res.json(await read(async session => {
        const ownerLegalEntityId = await owner(req, session), query = catalogOptionQuery(req.filter, type, ownerLegalEntityId, q, cursor), rows = await db.collection(catalogOptionCollection).find(query, { session }).hint(catalogOptionIndexes[type]).sort({ _id: 1 }).limit(limit + 1).toArray(), data = [];
        for (const candidate of rows.slice(0, limit)) {
          const row = await db.collection(name).findOne({ ...req.filter, _id: candidate._id }, { session });
          if (!row || !isDeepStrictEqual(candidate, catalogOptionProjection(type, row))) fail(409, 'CATALOG_SOURCE_INVALID');
          const option = await rowView(req, type, row, session, ownerLegalEntityId); if (!option.eligible) fail(409, 'CATALOG_SOURCE_INVALID'); data.push(option);
        }
        return { data, page: { limit, nextCursor: rows.length > limit ? data.at(-1)._id : null }, query: { q, eligibility, ordering: '_id_asc', consistency: 'LIVE' } };
      }));
    });
    app.get(`${path}/:id`, async (req, res) => {
      await authorize(req); res.json({ data: await read(async session => { const ownerLegalEntityId = await owner(req, session), row = await db.collection(name).findOne({ ...req.filter, _id: id(req.params.id) }, { session }); if (!row) fail(404, 'NOT_FOUND'); return rowView(req, type, row, session, ownerLegalEntityId); }) });
    });
  }
}
