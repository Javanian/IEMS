import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const read=path=>readFile(new URL(`../../${path}`,import.meta.url));
const domain=JSON.parse(await readFile(new URL('./domain-registry.json',import.meta.url),'utf8'));
const paths=[...Object.keys(domain.sources),'packages/tenant-lifecycle/admission.mjs','packages/tenant-lifecycle/index.mjs','packages/tenant-lifecycle/domain-port.mjs','packages/tenant-lifecycle/admission-registry.mjs'],sources={};
for(const path of paths) sources[path]=createHash('sha256').update((await read(path)).toString('utf8').replaceAll('\r\n','\n')).digest('hex');
const actual=JSON.parse(await readFile(new URL('./admission-routes.json',import.meta.url),'utf8'));
const wrappers={
  foundationCommandResults:{filter:['tenantId','plantId','userId','action','key'],hash:'contentHash({action,aggregateId,expectedRevision,input})',hook:'packages/tenant-foundation/commands.mjs',replay:'current domain/delegated foundation authorization before receipt lookup'},
  manufacturingKeys:{filter:['tenantId','plantId','key'],hash:'existing canonical({kind,id,expectedVersion,payload}) SHA256',hook:'apps/portfolio-api/src/manufacturing.mjs',replay:'source order authority and current host authorization'},
  warehouseKeys:{filter:['tenantId','plantId','key'],hash:'existing JSON.stringify({kind,id,...payload}) SHA256',hook:'apps/portfolio-api/src/warehouse.mjs',replay:'source order authority and current host authorization'},
  fulfillmentKeys:{filter:['tenantId','plantId','key'],hash:'existing canonical({kind,payload}) SHA256',hook:'apps/portfolio-api/src/fulfillment.mjs',replay:'purchased/manufactured/deposit/invoice posting validators retained before admission'},
};
for(const prefix of ['quality','maintenance','operations']) wrappers[`${prefix}Keys`]={filter:['tenantId','plantId','key'],hash:'existing stockHash({action,params,body}); operations retains original actor-to-key contentHash',hook:'apps/portfolio-api/src/quality.mjs',replay:'current host/helper source authorization',nested:'one scopedModule receipt including voice; no independently charged child'};
function classify(route) {
 const [method,path]=route.split(' ');
 if(path.startsWith('/api/session/'))return {state:'AUTH_RECOVERY',meter:'NONE'};
 if(path.startsWith('/api/saas/'))return {state:'CONTROL_PLANE',meter:'SEPARATE_ADMIN_RECEIPT'};
 if(path==='/api/cs/automation/sla-breaches')return {state:'UNSUPPORTED',meter:'NONE',note:'GET schedules automation tasks in the existing transaction; rejects enrolled tenants.'};
 if(method==='GET')return {state:'READ',meter:'NONE'};
 let receipt;
 if(path.startsWith('/api/manufacturing/'))receipt='manufacturingKeys';
 if(path.startsWith('/api/warehouse/')&&!path.includes('/holds'))receipt='warehouseKeys';
 if(['/api/fulfillment/shipments','/api/fulfillment/manufactured-shipments','/api/fulfillment/invoices','/api/fulfillment/payments','/api/fulfillment/deposits','/api/fulfillment/packing'].includes(path)||/^\/api\/fulfillment\/packing\/[^/]+\/pack$/.test(path))receipt='fulfillmentKeys';
 if(path.startsWith('/api/repair/quality/'))receipt='qualityKeys';
 if(path.startsWith('/api/repair/maintenance/'))receipt='maintenanceKeys';
 if(path.startsWith('/api/operations/'))receipt='operationsKeys';
 if(path.startsWith('/api/portals/')||['/api/ai/documents/:id','/api/ai/documents/:id/publish','/api/ai/documents/:id/revoke','/api/ai/documents/:id/index/revoke','/api/ai/models/select'].includes(path)||/^\/api\/ai\/vendor-drafts\/[^/]+\/(create|preview|approve|revoke|intent)$/.test(path))receipt='foundationCommandResults';
 if(['/api/ai/retrieve','/api/ai/predictions','/api/ai/cs-intent','/api/ai/assistant'].includes(path))return {state:'ADVISORY_READ',meter:'NONE',note:'No business write; source/authorization fences retained. Provider availability/cost separately gated.'};
 return receipt?{state:'RECEIPTED',receipt,meter:'ONE_COMMAND',nested:'Children inherit wrapper session; separately committed foundation command is independent'}:{state:'UNSUPPORTED',meter:'NONE',note:'No admitted effect under this profile; transaction/port rejects enrolled tenant before business effect. Existing validators may reject earlier.'};
}
const registry={schema:'SAAS_ADMISSION_REGISTRY_V1',profile:'RECEIPTED_COMMANDS_V1',base:'55766c6a87e5b81a2b9f267a451b3c2cce2d242f',fullEndpointCoverage:false,
  unit:'command-count',storageBytes:'Cumulative explicitly admitted bytes; not measured disk occupancy or invoice billing',wrappers,
  constructors:paths.filter(path=>/foundation-runtime|portals|customer-service\/index|scoped-ai\/(documents|indexing|models|vendor-drafts)/.test(path)),
  system:'Private reporting relay, authorization/source/read fences, internal job retries and init/index creation are not independent billable user commands. Public job ingress is unsupported.',
  externalEnrollment:'Any automation_engine_runs history blocks enrollment until authoritative quiescence/reconciliation is designed; an engine HTTP ACK does not prove effects stopped.',sources,routes:actual.map(route=>({route,...classify(route)}))};
await writeFile(new URL('./admission-registry.json',import.meta.url),JSON.stringify(registry,null,2)+'\n');
console.log(`${registry.routes.length} actual routes, ${Object.keys(sources).length} source pins; full endpoint coverage false`);
