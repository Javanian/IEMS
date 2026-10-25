import { createHash } from 'node:crypto';

export const catalogOptionCollection = 'catalogOptionSearch';
export const catalogOptionPrefixIndex = 'catalog_option_prefixes';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const normalizeCatalogSearch = value => value.toLowerCase();
export function catalogOptionProjection(type, source) {
  const values = type === 'items' ? [source.code, source.content?.description] : [source.name], prefixes = new Set(['']);
  for (const value of values) if (typeof value === 'string') { const normalized = normalizeCatalogSearch(value); for (let length = 1; length <= Math.min(80, normalized.length); length++) prefixes.add(normalized.slice(0, length)); }
  const eligible = type === 'items' ? source.status === 'APPROVED' && source.content?.kind === 'PURCHASED' && source.content?.schema === 'INVENTORY_ITEM_V2' && ['LOT', 'SERIAL'].includes(source.content?.trackingPolicy) : !Object.hasOwn(source, 'active') || source.active === true;
  const binding = type === 'items' ? [source.version, source.authorityHash] : [source.version, source.name, Object.hasOwn(source, 'active'), source.active];
  const quoteEligible = type === 'items' && source.status === 'APPROVED' && source.content?.schema === 'INVENTORY_ITEM_V2' && (source.content?.kind === 'PURCHASED' && ['LOT', 'SERIAL'].includes(source.content?.trackingPolicy) || source.content?.kind === 'MANUFACTURED' && source.content?.trackingPolicy === 'SERIAL');
  return { quoteEligible, _id: source._id, tenantId: source.tenantId, plantId: source.plantId, type, ownerLegalEntityId: type === 'items' ? source.ownerLegalEntityId : null, eligible, prefixes: [...prefixes].sort(), sourceVersion: source.version, sourceAuthorityHash: digest(binding) };
}
export async function saveCatalogOptionProjection(db, type, source, session) {
  const projection = catalogOptionProjection(type, source);
  await db.collection(catalogOptionCollection).replaceOne({ _id: projection._id, tenantId: projection.tenantId, plantId: projection.plantId, type }, projection, { upsert: true, session });
}
export async function initializeCatalogOptionIndex(db) {
  await db.collection(catalogOptionCollection).createIndex({ tenantId: 1, plantId: 1, type: 1, ownerLegalEntityId: 1, eligible: 1, prefixes: 1, _id: 1 }, { name: catalogOptionPrefixIndex });
  // Startup runs before serving HTTP. Existing sources and concurrent writers share a real source fence.
  for (const [type, collection] of [['items', 'inventoryItems'], ['vendors', 'vendors']]) {
    let cursor;
    for (;;) {
      const batch = await db.collection(collection).find(cursor ? { _id: { $gt: cursor } } : {}).sort({ _id: 1 }).limit(100).toArray();
      if (!batch.length) break;
      for (const candidate of batch) {
        const session = db.client.startSession();
        try {
          await session.withTransaction(async () => {
            const source = await db.collection(collection).findOne({ _id: candidate._id }, { session });
            if (!source) return;
            const filter = { _id: source._id, tenantId: source.tenantId, plantId: source.plantId, version: source.version, ...(type === 'items' ? { authorityHash: source.authorityHash } : { name: source.name, active: Object.hasOwn(source, 'active') ? source.active : { $exists: false } }) };
            const written = await db.collection(collection).updateOne(filter, { $inc: { [type === 'items' ? 'useFence' : 'catalogSearchFence']: 1 } }, { session });
            if (written.matchedCount !== 1) throw Object.assign(new Error('CATALOG_SEARCH_REBUILD_CONFLICT'), { code: 'CATALOG_SEARCH_REBUILD_CONFLICT' });
            await saveCatalogOptionProjection(db, type, source, session);
          }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
        } finally { await session.endSession(); }
      }
      cursor = batch.at(-1)._id;
    }
  }
}
