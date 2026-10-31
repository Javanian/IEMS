// Development-only inventory generation. Review the classified output before committing it.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const inventory={};
const sources={};
const roots=['apps/portfolio-api/src','packages/contracts/src/domains','packages/customer-service','packages/scoped-ai','packages/domain-events','packages/document-rendering/src','packages/tenant-foundation','packages/durable-jobs','packages/cache-coordination'];
async function walk(dir){for(const e of await readdir(resolve(root,dir),{withFileTypes:true})){
  const path=`${dir}/${e.name}`;
  if(e.isDirectory()){if(!['node_modules','test'].includes(e.name))await walk(path);continue;}
  if(!e.name.endsWith('.mjs')||e.name.includes('.test.')||['tenant-lifecycle.mjs','seed-cli.mjs','server.mjs'].includes(e.name))continue;
  let text=(await readFile(resolve(root,path),'utf8')).replaceAll('\r\n','\n');
  const names=new Set();
  for(const re of [/(?:\.collection|\bc)\(\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g,/\bc\(\s*runtime\s*,\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]/g,/\[\s*['"]([A-Za-z][A-Za-z0-9_]*)['"]\s*,\s*\{\s*(?:tenantId|_id)\s*:/g])for(const m of text.matchAll(re))names.add(m[1]);
  if(names.size)inventory[path]=[...names].sort();
  if(path==='apps/portfolio-api/src/app.mjs')text=text.slice(text.indexOf('function installCrm('));
  const fields=new Set(['_id','tenantId','plantId','legalEntityId']);
  for(const re of [/\b([A-Za-z_][A-Za-z0-9_]*)\s*:/g,/\.([A-Za-z_][A-Za-z0-9_]*)\b/g,/['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g])
    for(const m of text.matchAll(re))fields.add(m[1]);
  sources[path]={sha256:createHash('sha256').update(text).digest('hex'),fields:[...fields].sort(),...(path.endsWith('/app.mjs')?{section:'function installCrm('}:{})};
}}
for(const dir of roots)await walk(dir);
{
  const path='packages/tenant-lifecycle/local-commands.mjs',text=(await readFile(resolve(root,path),'utf8')).replaceAll('\r\n','\n');
  const fields=new Set(['_id','tenantId','plantId','userId','action','key','resourceId','inputHash','result','schemaVersion','occurredAt']);
  for(const re of [/\b([A-Za-z_][A-Za-z0-9_]*)\s*:/g,/\.([A-Za-z_][A-Za-z0-9_]*)\b/g,/['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g])for(const m of text.matchAll(re))fields.add(m[1]);
  sources[path]={sha256:createHash('sha256').update(text).digest('hex'),fields:[...fields].sort()};
}
const names=new Set(Object.values(inventory).flat());
for(const n of ['catalogPurchaseRequests','purchasedFulfillmentAudit','purchasedFulfillmentOutbox','qualityAudit','qualityOutbox','maintenanceAudit','maintenanceOutbox','operationsAudit','operationsOutbox','catalogOptionSearch','files','exports','readModels','saasSubscriptions','saasLifecycleArchives'])names.add(n);
const protectedNames=new Set(['credentials','sessions','memberships','users','tenants','plants','legalEntities','audit','outbox','foundationCommandResults','jobs','platformRateLimits','ownedRun','files','exports','readModels','analyticsHeads','analyticsReceipts','saasSubscriptions','saasLifecycleArchives','reportingSourceCoverage','reportingSourceQuarantine','catalogOptionSearch']);
const collections={};
for(const name of ['crmCommandResults','legacyQuoteCommandResults','procurementCommandResults'])names.add(name);
for(const name of [...names].sort()){
  const retained=protectedNames.has(name)||/^cs_|^automation_|^portal_|^workforce|^voice|^aiVendor|^aiDocument|^aiIndex/.test(name)||/Outbox$/.test(name);
  collections[name]={disposition:retained?'RETAIN_PRIVATE_OR_TECHNICAL':'BUSINESS',schema:retained?null:'PINNED_BSON_BUSINESS_V1',sources:Object.entries(inventory).filter(([,v])=>v.includes(name)).map(([p])=>p),
    ...(retained?{reason:protectedNames.has(name)?'Identity, security, technical authority or recovery evidence; never export or remove':'Private message/biometric/transport evidence; retained without content export'}:{})};
}
for(const [name,paths]of Object.entries({catalogPurchaseRequests:['apps/portfolio-api/src/catalog-procurement.mjs'],
  purchasedFulfillmentAudit:['apps/portfolio-api/src/purchased-fulfillment.mjs'],
  qualityAudit:['apps/portfolio-api/src/quality.mjs'],maintenanceAudit:['apps/portfolio-api/src/quality.mjs','apps/portfolio-api/src/maintenance.mjs'],operationsAudit:['apps/portfolio-api/src/quality.mjs','apps/portfolio-api/src/operations.mjs']}))collections[name].sources=paths;
collections.accounts.fields=['_id','tenantId','plantId','ownerId','version','createdAt','updatedAt','name','useFence','documentFence'];
collections.contacts.fields=['_id','tenantId','plantId','ownerId','version','createdAt','updatedAt','name','email','accountId','useFence'];
for(const [name,path]of Object.entries({crmCommandResults:'apps/portfolio-api/src/app.mjs',legacyQuoteCommandResults:'apps/portfolio-api/src/commercial.mjs',procurementCommandResults:'apps/portfolio-api/src/procurement.mjs'})) {
  collections[name].sources=[path,'packages/tenant-lifecycle/local-commands.mjs'];
  collections[name].fields=['_id','tenantId','plantId','userId','action','key','resourceId','inputHash','result','schemaVersion','occurredAt'];
}
const result={schema:'IEMS_BUSINESS_ARCHIVE_REGISTRY_V1',base:'55766c6a87e5b81a2b9f267a451b3c2cce2d242f',coverageScope:'REGISTERED_MONGO_BUSINESS_GRAPH_V1',sources,collections};
await writeFile(new URL('./domain-registry.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(`Reviewed source inventory candidate: ${Object.keys(collections).length} collections, ${Object.keys(sources).length} pinned source schemas. ${relative(root,fileURLToPath(new URL('./domain-registry.json',import.meta.url)))}`);
