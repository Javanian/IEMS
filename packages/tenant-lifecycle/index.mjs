import { randomUUID } from 'node:crypto';
import { boundedTransaction, createCommandExecutor, contentHash, CommandError } from '../tenant-foundation/commands.mjs';

export const lifecycleRoles = {
  saasUser: ['saas.use'],
  saasReader: ['saas.read'],
  saasOperator: ['saas.read','saas.subscribe','saas.meter','saas.suspend','saas.resume','saas.export','saas.delete','saas.restore'],
};
export const plans = Object.freeze({
  pilot: { apiCalls: '10000', exports: '10', storageBytes: '1073741824' },
  standard: { apiCalls: '100000', exports: '100', storageBytes: '10737418240' },
});
const zero = () => ({ apiCalls: '0', exports: '0', storageBytes: '0' });
const fail = (code, status = 400) => { throw new CommandError(code,status); };
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const units = x => typeof x === 'string' && /^(0|[1-9]\d{0,23})$/.test(x);
const clean = row => row ? { tenantId: row.tenantId, revision: row.revision, plan: row.plan, state: row.state,
  period: row.period, usage: row.usage, changedAt: row.changedAt, admissionProfile:row.admissionProfile??null, limits: plans[row.plan] } : null;
export function addUsage(usage, metric, amount, limits) {
  if (typeof metric !== 'string' || !Object.hasOwn(limits,metric) || !units(amount) || BigInt(amount) === 0n || !units(usage[metric])) fail('INVALID_METER');
  const next = BigInt(usage[metric]) + BigInt(amount);
  if (next > BigInt(limits[metric])) fail('SAAS_QUOTA_EXCEEDED',429);
  return { ...usage, [metric]: next.toString() };
}

// Domain export/delete/restore stays unavailable until an authoritative complete-scope port is wired.
export function createTenantLifecycle({ client, db, foundation, domainPort = null, enrollmentGuard = null, documentPort = null, saasAdmission, separateEffects = null, clock = () => new Date() }) {
  const rows = db.collection('saasSubscriptions'), archives = db.collection('saasLifecycleArchives');
  const administrativeAdmission = saasAdmission?.controlPlane ?? (async descriptor => {
    if(descriptor.namespace!=='foundationCommandResults' || !lifecycleRoles.saasOperator.includes(descriptor.action)) fail('SAAS_CONTROL_PLANE_COMMAND_INVALID',500);
  });
  const commands = createCommandExecutor({client,db,admission:administrativeAdmission,foundation:{authorizeInTransaction:(scope,target,{session}) => tenantGrant(scope,target.plantId,target.action,session)}});
  function shape(input, keys) {
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).some(k => !keys.includes(k)) || !uuid(input.plantId)) fail('INVALID_SAAS_REQUEST');
  }
  async function tenantGrant(scope, plantId, action, session, readOnly=false) {
    const grant = readOnly?await foundation.authorize(scope,{tenantId:scope?.tenantId,plantId,action}):await foundation.authorizeInTransaction(scope,{ tenantId: scope?.tenantId, plantId, action },{session});
    const member = await db.collection('memberships').findOne({ _id: grant.membershipId, tenantId: grant.tenantId, active:true, version:grant.membershipVersion },{session});
    if (!member?.tenantWide || !member.roles?.some(g => g.tenantWide && lifecycleRoles[g.role]?.includes(action))) fail('TENANT_WIDE_SAAS_GRANT_REQUIRED',403);
    return grant;
  }
  const period = () => clock().toISOString().slice(0,7);
  function current(row) {
    return row.period === period() ? row : { ...row, period:period(), usage:zero() };
  }
  async function mutate(scope,input,action,keys,effect) {
    shape(input,['plantId','key','expectedRevision','reason',...keys]);
    if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) fail('SAAS_REASON_REQUIRED');
    return commands.execute(scope,{tenantId:scope?.tenantId,plantId:input.plantId,action,key:input.key,
      aggregateId:scope?.tenantId,expectedRevision:input.expectedRevision,input},async ({session,expectedRevision}) => {
      const grant = await tenantGrant(scope,input.plantId,action,session), filter = {tenantId:grant.tenantId};
      const prior = await rows.findOne(filter,{session});
      if ((prior?.revision ?? 0) !== expectedRevision) fail('REVISION_CONFLICT',409);
      const row = prior ? current(prior) : { _id:randomUUID(), ...filter, revision:0, plan:'pilot', state:'UNSUBSCRIBED', period:period(), usage:zero() };
      const extra = await effect(row,{session,grant,prior});
      row.revision = expectedRevision+1; row.changedAt = clock().toISOString();
      if (prior) {
        const result = await rows.replaceOne({...filter,revision:expectedRevision},row,{session});
        if (result.matchedCount !== 1) fail('REVISION_CONFLICT',409);
      } else await rows.insertOne(row,{session});
      return {revision:row.revision,data:{subscription:clean(row),...extra},events:[{type:action,version:1,data:{tenantId:grant.tenantId,revision:row.revision,state:row.state}}]};
    });
  }
  const requireState = (row, states) => { if (!states.includes(row.state)) fail('SAAS_INVALID_STATE',409); };
  async function historyQuiescent(tenantId,session){
    if(separateEffects)await separateEffects.assertQuiescent({tenantId,session});
    for(const [name,filter,key] of [['automation_engine_runs',{},'runId'],['aiVendorDeliveryAttempts',{},'attemptIds'],['cs_outbox',{state:{$in:['SENDING','UNKNOWN']}},'deliveryIds']]){
      const cursor=db.collection(name).find({tenantId,...filter},{session}).limit(1001),history=await cursor.toArray();if(history.length>1000)fail('SAAS_ENROLLMENT_EXTERNAL_EFFECT_PENDING',409);
      for(const record of history){if(!separateEffects||!record.controlCommandId)fail('SAAS_ENROLLMENT_EXTERNAL_EFFECT_PENDING',409);await separateEffects.verifyManagedRecord({tenantId,commandId:record.controlCommandId,reference:{key,id:record._id},session});}
    }
  }
  const port = () => { if (!domainPort || !['snapshot','remove','restore'].every(k => typeof domainPort[k] === 'function')) fail('TENANT_DATA_PORT_UNAVAILABLE',503); };
  function snapshotValid(snapshot,tenantId) {
    if (snapshot?.schema !== 'TENANT_EXPORT_V1' || snapshot.tenantId !== tenantId || snapshot.coverage !== 'COMPLETE' ||
      typeof snapshot.sourceRevision !== 'string' || !snapshot.sourceRevision || !Array.isArray(snapshot.resources) || snapshot.resources.length > 1000 ||
      snapshot.resources.some(r => !uuid(r.id) || r.tenantId !== tenantId) || new Set(snapshot.resources.map(r => r.id)).size !== snapshot.resources.length) fail('TENANT_EXPORT_INCOMPLETE',409);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 2_000_000) fail('TENANT_EXPORT_TOO_LARGE',413);
    contentHash(snapshot);
  }
  return Object.freeze({
    async initialize() {
      await commands.initialize(); await rows.createIndex({tenantId:1},{unique:true});
      await archives.createIndex({tenantId:1,_id:1},{unique:true});
    },
    async status(scope,input) {
      shape(input,['plantId']);
      const result=await boundedTransaction(client,async session => {
        const grant = await tenantGrant(scope,input.plantId,'saas.read',session,true);
        const row = await rows.findOne({tenantId:grant.tenantId},{session});
        return {schema:'SAAS_STATUS_V1',subscription:row ? clean(current(row)) : null,plans,quiescence:separateEffects?await separateEffects.quiescence({tenantId:grant.tenantId,session}):{state:'UNCONFIGURED'},
          admission:{profile:'RECEIPTED_COMMANDS_V1',fullEndpointCoverage:false,
            supported:'Receipt-backed keyed CRM, legacy quotes/procurement, manufacturing, repair, internal production, inventory and stock holds, inquiries, shortages, catalog procurement/disposition, purchased fulfillment, delivery/returns, workforce, operations and selected quote, procurement, document, model and portal commands; public job ingress and selected private customer-service receipts. Enrolled simulator inbound and automation resolution/digest intents remain locally queued. Four standalone private/operator CS roots preserve immutable results; explicit human local preview, administrative receipts, one-time-no-recovery credentials and bounded LOCAL_OBSERVE_V1 are supported. SLA escalation and resolution draft creation retain their existing receipts.',
            unsupported:'Unkeyed enrolled CRM/legacy quote/procurement requests, independently committing customer-service workers, full legacy automation recovery and external engine/sender effects, AI indexing rebuild/cleanup and AI delivery dispatch/reconciliation.',
            enrollmentBoundary:'Enrollment requires command-aware clients; older unkeyed forms may be unavailable. Unsupported business mutations are blocked. Existing automation engine history prevents enrollment until authoritative quiescence can be established.'},
          domainLifecycleConfigured:!!domainPort, billing:'SAAS_METERING_ONLY_NO_PAYMENT_COLLECTION',
          boundary:'Tenant invoices are separate. Delete is a reversible archive workflow, not certified erasure. Domain effects require a complete authoritative transactional port.'};
      });await tenantGrant(scope,input.plantId,'saas.read',undefined,true);return result;
    },
    subscribe(scope,input) { return mutate(scope,input,'saas.subscribe',['plan','admissionProfile'],async (row,{session,grant}) => {
      if(enrollmentGuard)await enrollmentGuard(input.admissionProfile);
      if(enrollmentGuard)await historyQuiescent(grant.tenantId,session);
      if(enrollmentGuard) {
        try {
          if(!documentPort?.validateTenantHistory) {
            for(const name of ['documentIntents','documentIssues','documentArtifacts']) if(await db.collection(name).findOne({tenantId:grant.tenantId},{session})) fail('DOCUMENT_HISTORY_RECONCILIATION_REQUIRED',409);
          } else await documentPort.validateTenantHistory({tenantId:grant.tenantId,session});
        } catch(error) { if(error.code) throw error; fail('DOCUMENT_HISTORY_RECONCILIATION_REQUIRED',409); }
      }
      requireState(row,['UNSUBSCRIBED','ACTIVE','SUSPENDED']);
      if (typeof input.plan !== 'string' || !Object.hasOwn(plans,input.plan)) fail('INVALID_SAAS_PLAN');
      if (Object.keys(row.usage).some(k => BigInt(row.usage[k]) > BigInt(plans[input.plan][k]))) fail('PLAN_BELOW_USAGE',409);
      row.plan = input.plan; if (row.state === 'UNSUBSCRIBED') row.state='ACTIVE';
      if(enrollmentGuard)row.admissionProfile=input.admissionProfile;
      if(separateEffects&&row.state==='ACTIVE')await separateEffects.openInSession({tenantId:grant.tenantId,session});
    }); },
    meter(scope,input) { return mutate(scope,input,'saas.meter',['metric','amount'],async row => {
      requireState(row,['ACTIVE']); row.usage=addUsage(row.usage,input.metric,input.amount,plans[row.plan]);
    }); },
    async quiesce(scope,input){shape(input,['plantId']);const grant=await boundedTransaction(client,async session=>{const grant=await tenantGrant(scope,input.plantId,'saas.suspend',session);if(!separateEffects)fail('EFFECT_ADAPTER_UNPROVEN',503);await separateEffects.closeInSession({tenantId:grant.tenantId,session});return grant;});return separateEffects.stopAndDrain(grant.tenantId);},
    suspend(scope,input) { return mutate(scope,input,'saas.suspend',[],async (row,{session,grant}) => {requireState(row,['ACTIVE']);if(separateEffects)await separateEffects.closeInSession({tenantId:grant.tenantId,session});row.state='SUSPENDED';}); },
    resume(scope,input) { return mutate(scope,input,'saas.resume',[],async (row,{session,grant}) => {requireState(row,['SUSPENDED']);if(separateEffects)await separateEffects.openInSession({tenantId:grant.tenantId,session});row.state='ACTIVE';}); },
    export(scope,input) { return mutate(scope,input,'saas.export',[],async (row,{session,grant}) => {
      requireState(row,['ACTIVE','SUSPENDED']); port();
      await historyQuiescent(grant.tenantId,session);
      row.usage=addUsage(row.usage,'exports','1',plans[row.plan]);
      const snapshot=await domainPort.snapshot({scope,grant,session}); snapshotValid(snapshot,grant.tenantId);
      const archiveId=randomUUID(), digest=contentHash(snapshot);
      await archives.insertOne({_id:archiveId,tenantId:grant.tenantId,snapshot,digest,subscriptionRevision:row.revision+1,deleted:false,restored:false,createdAt:clock().toISOString()},{session});
      row.archiveId=archiveId;
      return {archiveId,digest,sourceRevision:snapshot.sourceRevision};
    }); },
    delete(scope,input) { return mutate(scope,input,'saas.delete',['archiveId','digest'],async (row,{session,grant}) => {
      requireState(row,['SUSPENDED']); port();
      await historyQuiescent(grant.tenantId,session);
      if (!uuid(input.archiveId) || row.archiveId !== input.archiveId) fail('ARCHIVE_NOT_CURRENT',409);
      const archive=await archives.findOne({_id:input.archiveId,tenantId:grant.tenantId,deleted:false},{session});
      if (!archive || archive.digest !== input.digest || contentHash(archive.snapshot) !== archive.digest) fail('ARCHIVE_INTEGRITY_INVALID',409);
      const currentSnapshot=await domainPort.snapshot({scope,grant,session}); snapshotValid(currentSnapshot,grant.tenantId);
      if (contentHash(currentSnapshot) !== archive.digest) fail('EXPORT_STALE',409);
      const proof=await domainPort.remove({scope,grant,session,snapshot:archive.snapshot});
      if (proof?.state !== 'REMOVED' || proof.sourceRevision !== archive.snapshot.sourceRevision) fail('DOMAIN_DELETE_UNCONFIRMED',409);
      await archives.updateOne({_id:archive._id,tenantId:grant.tenantId,deleted:false},{$set:{deleted:true}},{session}); row.state='ARCHIVED';
    }); },
    restore(scope,input) { return mutate(scope,input,'saas.restore',['archiveId','digest'],async (row,{session,grant}) => {
      requireState(row,['ARCHIVED']); port();
      await historyQuiescent(grant.tenantId,session);
      if (!uuid(input.archiveId) || row.archiveId !== input.archiveId) fail('ARCHIVE_NOT_CURRENT',409);
      const archive=await archives.findOne({_id:input.archiveId,tenantId:grant.tenantId,deleted:true,restored:false},{session});
      if (!archive || archive.digest !== input.digest || contentHash(archive.snapshot) !== archive.digest) fail('ARCHIVE_INTEGRITY_INVALID',409);
      const proof=await domainPort.restore({scope,grant,session,snapshot:archive.snapshot});
      if (proof?.state !== 'RESTORED' || proof.digest !== archive.digest) fail('DOMAIN_RESTORE_UNCONFIRMED',409);
      await archives.updateOne({_id:archive._id,tenantId:grant.tenantId},{$set:{restored:true}},{session}); row.state='SUSPENDED';
    }); },
    async download(scope,input) {
      shape(input,['plantId','archiveId']); if (!uuid(input.archiveId)) fail('INVALID_ARCHIVE');
      return boundedTransaction(client,async session => {
        const grant=await tenantGrant(scope,input.plantId,'saas.export',session);
        const a=await archives.findOne({_id:input.archiveId,tenantId:grant.tenantId},{session});
        if (!a || a.deleted || contentHash(a.snapshot) !== a.digest) fail('ARCHIVE_UNAVAILABLE',404);
        return {schema:'SAAS_EXPORT_DOWNLOAD_V1',archiveId:a._id,digest:a.digest,snapshot:a.snapshot};
      });
    },
    async assertEntitled(scope,{plantId,session,metric,amount='1'}) {
      if (!session?.inTransaction()) fail('TRANSACTION_REQUIRED',500);
      const grant=await foundation.authorizeInTransaction(scope,{tenantId:scope?.tenantId,plantId,action:'saas.use'},{session});
      const row=await rows.findOne({tenantId:grant.tenantId},{session}); if (!row) fail('SAAS_SUBSCRIPTION_REQUIRED',403);
      requireState(row,['ACTIVE']); const next=current(row); next.usage=addUsage(next.usage,metric,amount,plans[next.plan]);
      const result=await rows.updateOne({tenantId:grant.tenantId,revision:row.revision,state:'ACTIVE'},{$set:{usage:next.usage,period:next.period},$inc:{revision:1}},{session});
      if(result.matchedCount!==1) fail('REVISION_CONFLICT',409);
      const eventId=randomUUID(), occurredAt=clock();
      await db.collection('audit').insertOne({_id:eventId,...grant,kind:'saas.usage.consumed',subjectId:grant.tenantId,revision:row.revision+1,occurredAt},{session});
      await db.collection('outbox').insertOne({_id:randomUUID(),tenantId:grant.tenantId,plantId:grant.plantId,legalEntityId:grant.legalEntityId,
        aggregateId:grant.tenantId,aggregateRevision:row.revision+1,type:'saas.usage.consumed',schemaVersion:1,data:{metric,amount,period:next.period},occurredAt,publishedAt:null},{session});
      return {tenantId:grant.tenantId,plan:row.plan};
    },
  });
}
