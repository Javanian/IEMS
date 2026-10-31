import { contentHash } from '../../packages/tenant-foundation/commands.mjs';
import { uuid } from '../../ops/pilot/rehearsal.mjs';
const invalid=()=>{throw new Error('Invalid or incomplete scoped cloud envelope');};
export function dataLayout({tenantId,plantId,eventId,payload}) {
  if(![tenantId,plantId,eventId].every(uuid)||!payload||payload.tenantId!==tenantId||payload.plantId!==plantId)invalid();
  const payloadHash=contentHash(payload),payloadJson=JSON.stringify(payload);
  if(Buffer.byteLength(payloadJson)>1_000_000)invalid();
  return {schema:'CLOUD_DATA_LAYOUT_V1',evidenceClass:'OFFLINE_ONLY',tenantId,plantId,eventId,payloadHash,
    msk:{topic:`iems.reporting-snapshots.v2.${tenantId}`,group:`iems-${tenantId}`,securityProtocol:'SASL_SSL',saslMechanism:'AWS_MSK_IAM'},
    s3:{key:`tenants/${tenantId}/reporting-v2/${plantId}/${eventId}/${payloadHash}.json`,body:{event_id:eventId,tenant_id:tenantId,plant_id:plantId,payload_hash:payloadHash,payload_json:payloadJson}},
    glue:{database:`iems_${tenantId.replaceAll('-','_')}`,table:'reporting_snapshots_v2'},
    redshift:{database:'iems',namespace:`iems-${tenantId}`,sslRequired:true,publicAccess:false}};
}
export function parity(source,target) {
  if(!Array.isArray(source)||!Array.isArray(target)||source.length>1000||target.length>1000)invalid();
  const normalize=rows=>{
    const ids=new Set();return rows.map(row=>{
      const result=dataLayout(row);if(ids.has(result.eventId))invalid();ids.add(result.eventId);
      return {eventId:result.eventId,tenantId:result.tenantId,plantId:result.plantId,payloadHash:result.payloadHash};
    }).sort((a,b)=>a.eventId.localeCompare(b.eventId));
  };
  const a=normalize(source),b=normalize(target);
  return {schema:'CLOUD_PARITY_V1',evidenceClass:'LOCAL_SYNTHETIC',state:contentHash(a)===contentHash(b)?'MATCH':'MISMATCH',
    sourceCount:a.length,targetCount:b.length,sourceHash:contentHash(a),targetHash:contentHash(b),actualCloudLineage:'NOT_RUN',actualCost:'NOT_MEASURED'};
}
