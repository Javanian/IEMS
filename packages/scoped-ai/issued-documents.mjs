import { createVendorDraftAuthority } from './vendor-source.mjs';
import { fail, uuid, scopeTarget } from './indexing.mjs';

export function validateApprovedOrderReference(reference) {
  if (!reference || Object.getPrototypeOf(reference) !== Object.prototype ||
      Object.keys(reference).some(k => !['cohort', 'vendorId', 'orderId', 'documentRevision', 'sourceHash'].includes(k)) ||
      !['LEGACY', 'CATALOG'].includes(reference.cohort) || ![reference.vendorId, reference.orderId].every(uuid) ||
      !Number.isSafeInteger(reference.documentRevision) || reference.documentRevision < 1 || !/^[a-f0-9]{64}$/.test(reference.sourceHash)) fail('AI_INVALID_ISSUED_REFERENCE');
}
export function createApprovedOrderDocumentSource(runtime) {
  const authority = createVendorDraftAuthority(runtime);
  const observationGrant=async(scope,grant)=>{const fresh=await runtime.foundation.authorize(scope,{tenantId:grant?.tenantId,plantId:grant?.plantId,action:'ai.vendor.source.read'});if(['tenantId','plantId','legalEntityId','userId','membershipId','membershipVersion'].some(key=>grant?.[key]!==fresh[key]))fail('SCOPE_DENIED',403);return fresh;};
  const read=async({scope,grant,reference,session},observation)=>{
    validateApprovedOrderReference(reference);
    if (!session?.inTransaction()) fail('SCOPE_DENIED', 403);if(observation&&session.client!==runtime.client)fail('SCOPE_DENIED',403);
    // A copied per-user document ACL never replaces current business-source authority.
    if(scope){if(observation)await observationGrant(scope,grant);else await runtime.foundation.authorizeInTransaction(scope,scopeTarget(scope,grant.plantId,'ai.vendor.source.read'),{session});}
    else {
      // Retrieval only supplies a verified grant; resolve its live membership policy through the host's opaque scope binding.
      fail('AI_ISSUED_SOURCE_SCOPE_REQUIRED', 403);
    }
    const { sourceHash, ...input } = reference;
    const source = await authority.source({ grant, reference: input, session });
    if (source.sourceHash !== sourceHash || source.documentRevision !== reference.documentRevision ||
        source.currentDocumentRevision !== reference.documentRevision) fail('AI_ISSUED_SOURCE_SUPERSEDED', 409);
    const title = `Approved ${reference.cohort} purchase order ${reference.orderId} revision ${reference.documentRevision}`;
    const text = [title, `Approved source hash: ${sourceHash}`, 'This is document evidence, not current fulfillment or delivery status.',
      ...source.lines.map(line => JSON.stringify(line)),
      ...['currency', 'taxPolicy', 'roundingPolicy', 'subtotal', 'tax', 'total'].filter(k => Object.hasOwn(source, k)).map(k => `${k}: ${source[k]}`)].join('\n');
    if(observation)await observationGrant(scope,grant);return {title,text};
  };return Object.freeze({readAuthorized:input=>read(input,false),readSnapshot:input=>read(input,true)});
}
