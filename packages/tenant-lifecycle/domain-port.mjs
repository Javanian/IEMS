import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { CommandError, contentHash } from '../tenant-foundation/commands.mjs';
const require=createRequire(new URL('../../apps/portfolio-api/package.json',import.meta.url));
const { BSON }=require('mongodb');
const freeze=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;};
const registry=freeze(JSON.parse(await readFile(new URL('./domain-registry.json',import.meta.url),'utf8')));
const registryHash=contentHash(registry), allFields=new Set(Object.values(registry.sources).flatMap(s=>s.fields));
const bad=(code,status=409)=>{throw new CommandError(code,status);};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
const privateField=/^(?:password|passwordHash|salt|secret|secretKey|privateKey|token|tokenHash|accessToken|refreshToken|cookie|authorization|pin|pinHash|nfcHash|biometric|biometricTemplate|messageBody|rawMessage|recipientToken)$/i;
const typed=new Set(['ObjectId','Binary','Decimal128','Long','Int32','Double','Timestamp']);
function checkDocument(row,fields,tenantId,collection) {
  function diagnosticAuthorization(path,value) {
    if(registry.collections[collection]?.businessAuthorizationPaths?.includes(path.join('.'))!==true) return false;
    const invoice=path.length===1?row:row.result;
    return invoice?.kind==='DIAGNOSTIC' && uuid(invoice.caseId) && value && Object.getPrototypeOf(value)===Object.prototype
      && Object.keys(value).sort().join(',')==='evidence,feeCap,kind,recordedAt,recordedBy,source'
      && value.kind==='DIAGNOSTIC_AUTHORIZED' && value.source==='OPERATOR_RECORDED'
      && typeof value.evidence==='string' && Boolean(value.evidence.trim()) && value.evidence.length<=1000
      && typeof value.feeCap==='string' && /^(0|[1-9][0-9]{0,27})(\.[0-9]{1,3})?$/.test(value.feeCap)
      && uuid(value.recordedBy) && value.recordedAt instanceof Date && Number.isFinite(value.recordedAt.getTime());
  }
  let nodes=0;
  function visit(x,depth=0,path=[]) {
    if(++nodes>50000||depth>32)bad('TENANT_SCHEMA_TOO_COMPLEX');
    if(x===null||['string','boolean'].includes(typeof x))return;
    if(typeof x==='number'){if(!Number.isFinite(x))bad('TENANT_SCHEMA_INVALID');return;}
    if(x instanceof Date){if(!Number.isFinite(x.getTime()))bad('TENANT_SCHEMA_INVALID');return;}
    if(Buffer.isBuffer(x)||(typed.has(x?._bsontype)&&Object.getPrototypeOf(x)!==Object.prototype))return;
    if(Array.isArray(x)){for(const v of x)visit(v,depth+1,path);return;}
    if(!x||Object.getPrototypeOf(x)!==Object.prototype)bad('TENANT_SCHEMA_INVALID');
    for(const [k,v]of Object.entries(x)){
      if(privateField.test(k) && !(k==='authorization' && diagnosticAuthorization([...path,k],v)))bad('TENANT_PRIVATE_FIELD');
      if(k.startsWith('$')||k.includes('.')||['__proto__','constructor','prototype'].includes(k)||!(depth===0?fields:allFields).has(k))bad('TENANT_SCHEMA_UNKNOWN_FIELD');
      if(k==='tenantId'&&v!==tenantId)bad('TENANT_SCOPE_INVALID',403);
      visit(v,depth+1,[...path,k]);
    }
  }
  visit(row);
  if(row.tenantId!==tenantId||row._id===undefined)bad('TENANT_SCHEMA_MISSING_SCOPE');
  for(const k of ['version','revision'])if(Object.hasOwn(row,k)&&(!Number.isSafeInteger(row[k])||row[k]<0))bad('TENANT_SCHEMA_INVALID_VERSION');
}
const encode=row=>BSON.EJSON.serialize(row,{relaxed:false});
const decode=row=>BSON.deserialize(BSON.serialize(BSON.EJSON.deserialize(row,{relaxed:false})));
const stableId=(collection,id)=>{
  const h=createHash('sha256').update(collection+'\n'+contentHash(encode({_id:id}))).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
};
export const businessRegistry=registry;
export async function verifySourceSchemas() {
  for(const [path,spec]of Object.entries(registry.sources)){
    let source=(await readFile(new URL(`../../${path}`,import.meta.url),'utf8')).replaceAll('\r\n','\n');
    if(spec.section)source=source.slice(source.indexOf(spec.section));
    if(createHash('sha256').update(source).digest('hex')!==spec.sha256)bad('TENANT_SOURCE_SCHEMA_CHANGED',503);
  }
}

export function createMongoTenantDataPort({db,foundation,maxResources=1000,maxBytes=2_000_000}) {
  if(!Number.isInteger(maxResources)||maxResources<1||maxResources>1000||!Number.isInteger(maxBytes)||maxBytes<1000||maxBytes>2_000_000)bad('INVALID_TENANT_ARCHIVE_BOUNDS',400);
  async function authorize({scope,grant,session},action) {
    if(!session?.inTransaction()||!scope)bad('TENANT_TRANSACTION_AUTHORITY_REQUIRED',403);
    const current=await foundation.authorizeInTransaction(scope,{tenantId:grant?.tenantId,plantId:grant?.plantId,action},{session});
    const member=await db.collection('memberships').findOne({_id:current.membershipId,tenantId:current.tenantId,active:true,version:current.membershipVersion},{session});
    if(!member?.tenantWide||!member.roles?.some(g=>g.tenantWide&&g.role==='saasOperator'))bad('TENANT_WIDE_SAAS_GRANT_REQUIRED',403);
    if(!uuid(current.tenantId))bad('TENANT_SCOPE_INVALID',403);
    return current;
  }
  async function inventory() {
    // Mongo catalog commands cannot participate in a transaction; business reads/writes below all do.
    const names=(await db.listCollections({}, {nameOnly:true}).toArray()).map(c=>c.name).sort();
    for(const name of names)if(!Object.hasOwn(registry.collections,name))bad('TENANT_UNKNOWN_COLLECTION',503);
    return names;
  }
  async function topology(tenantId,session) {
    const p=await db.collection('plants').find({tenantId},{session,projection:{_id:1,tenantId:1,legalEntityId:1,active:1}}).sort({_id:1}).limit(1001).toArray();
    const e=await db.collection('legalEntities').find({tenantId},{session,projection:{_id:1,tenantId:1,active:1}}).sort({_id:1}).limit(1001).toArray();
    if(p.length>1000||e.length>1000||!p.length||!e.length||p.some(x=>!e.some(y=>y._id===x.legalEntityId)))bad('TENANT_TOPOLOGY_INCOMPLETE');
    return {plants:p,entities:e};
  }
  async function snapshot(context) {
    const grant=await authorize(context,'saas.export'),{session}=context;
    await verifySourceSchemas();const names=await inventory(),top=await topology(grant.tenantId,session);
    const resources=[],collections=[];
    for(const [name,spec]of Object.entries(registry.collections)){
      if(spec.disposition!=='BUSINESS')continue;
      if(spec.schema!=='PINNED_BSON_BUSINESS_V1')bad('TENANT_SCHEMA_UNREGISTERED',503);
      const fields=new Set(spec.fields??spec.sources.flatMap(p=>registry.sources[p]?.fields??[]));
      if(!fields.size)bad('TENANT_SCHEMA_UNREGISTERED',503);
      if(await db.collection(name).findOne({tenantId:{$exists:false}},{session,projection:{_id:1}}))bad('TENANT_SCHEMA_MISSING_SCOPE');
      const rows=await db.collection(name).find({tenantId:grant.tenantId},{session}).sort({_id:1}).limit(maxResources-resources.length+1).toArray();
      if(rows.length+resources.length>maxResources)bad('TENANT_EXPORT_TOO_LARGE',413);
      collections.push({name,count:rows.length});
      for(const row of rows){
        checkDocument(row,fields,grant.tenantId,name);
        if(row.plantId!==undefined&&!top.plants.some(p=>p._id===row.plantId))bad('TENANT_SCOPE_INVALID',403);
        if(row.legalEntityId!==undefined&&!top.entities.some(e=>e._id===row.legalEntityId))bad('TENANT_SCOPE_INVALID',403);
        resources.push({id:stableId(name,row._id),tenantId:grant.tenantId,collection:name,document:encode(row)});
      }
      if(Buffer.byteLength(JSON.stringify(resources))>maxBytes)bad('TENANT_EXPORT_TOO_LARGE',413);
    }
    if(JSON.stringify(names)!==JSON.stringify(await inventory()))bad('TENANT_CATALOG_CHANGED');
    const body={tenantId:grant.tenantId,registryHash,scopeHash:contentHash(top),collections,resources};
    const result={schema:'TENANT_EXPORT_V1',coverage:'COMPLETE',coverageScope:registry.coverageScope,...body,sourceRevision:contentHash(body),
      retained:Object.entries(registry.collections).filter(([,s])=>s.disposition!=='BUSINESS').map(([collection,s])=>({collection,reason:s.reason})),
      excludedAuthority:'Foundation identities/grants, security, private messages/biometrics, transport and recovery evidence remain in place. This is complete registered Mongo business graph coverage, not erasure or an external-system backup.'};
    if(Buffer.byteLength(JSON.stringify(result))>maxBytes)bad('TENANT_EXPORT_TOO_LARGE',413);
    return result;
  }
  function validateSnapshot(snapshot,tenantId) {
    if(snapshot?.schema!=='TENANT_EXPORT_V1'||snapshot.coverage!=='COMPLETE'||snapshot.coverageScope!==registry.coverageScope||snapshot.registryHash!==registryHash||snapshot.tenantId!==tenantId||
      !Array.isArray(snapshot.resources)||snapshot.resources.length>maxResources||Buffer.byteLength(JSON.stringify(snapshot))>maxBytes)bad('TENANT_ARCHIVE_SCHEMA_INVALID');
    const {resources,collections,scopeHash}=snapshot;
    if(contentHash({tenantId,registryHash,scopeHash,collections,resources})!==snapshot.sourceRevision)bad('TENANT_ARCHIVE_INTEGRITY_INVALID');
    const ids=new Set();
    for(const r of resources){
      const spec=registry.collections[r.collection];if(!spec||spec.disposition!=='BUSINESS'||r.tenantId!==tenantId||ids.has(r.id))bad('TENANT_ARCHIVE_SCHEMA_INVALID');ids.add(r.id);
      const row=decode(r.document);checkDocument(row,new Set(spec.fields??spec.sources.flatMap(p=>registry.sources[p]?.fields??[])),tenantId,r.collection);
      if(stableId(r.collection,row._id)!==r.id||contentHash(encode(row))!==contentHash(r.document))bad('TENANT_ARCHIVE_SCHEMA_INVALID');
    }
    const counts=Object.entries(registry.collections).filter(([,s])=>s.disposition==='BUSINESS').map(([name])=>({name,count:resources.filter(r=>r.collection===name).length}));
    if(contentHash(counts)!==contentHash(collections))bad('TENANT_ARCHIVE_COVERAGE_INVALID');
  }
  return Object.freeze({snapshot,
    async remove(context) {
      const grant=await authorize(context,'saas.delete');validateSnapshot(context.snapshot,grant.tenantId);
      if(contentHash(await snapshot(context))!==contentHash(context.snapshot))bad('EXPORT_STALE');
      for(const r of context.snapshot.resources){
        const row=decode(r.document),result=await db.collection(r.collection).deleteOne({_id:row._id,tenantId:grant.tenantId},{session:context.session});
        if(result.deletedCount!==1)bad('TENANT_REMOVE_CONFLICT');
      }
      return {state:'REMOVED',sourceRevision:context.snapshot.sourceRevision};
    },
    async restore(context) {
      const grant=await authorize(context,'saas.restore');validateSnapshot(context.snapshot,grant.tenantId);
      const empty=await snapshot(context);
      if(empty.resources.length||empty.scopeHash!==context.snapshot.scopeHash)bad('TENANT_RESTORE_COLLISION');
      for(const r of context.snapshot.resources){
        const row=decode(r.document);
        if(await db.collection(r.collection).findOne({_id:row._id},{session:context.session}))bad('TENANT_RESTORE_COLLISION');
        await db.collection(r.collection).insertOne(row,{session:context.session});
      }
      if(contentHash(await snapshot(context))!==contentHash(context.snapshot))bad('TENANT_RESTORE_PARITY_FAILED');
      return {state:'RESTORED',digest:contentHash(context.snapshot)};
    },
  });
}
