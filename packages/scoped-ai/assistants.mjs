import { boundedCall, fail, scopeTarget, uuid } from './indexing.mjs';

const fields = { ORDER: ['kind', 'plantId', 'bindingId', 'orderNumber'],
  SERVICE_METRICS: ['kind', 'plantId', 'from', 'to'], DOCUMENTS: ['kind', 'plantId', 'query', 'limit'] };
const unavailable = new Set(['AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE', 'AI_EMBEDDING_UNAVAILABLE', 'STATUS_UNAVAILABLE']);
const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

export function createScopedAssistants({ foundation, customerService, rag, clock = () => new Date(), timeoutMs = 10000, maxAgeMs = 30000 }) {
  if (!foundation?.authorize || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 60000) fail('AI_ADAPTER_CONFIGURATION', 500);
  const authorize = (scope, plantId) => foundation.authorize(scope, scopeTarget(scope, plantId, 'ai.retrieve'));
  const fresh = asOf => {
    const time = asOf instanceof Date ? asOf.getTime() : typeof asOf === 'string' && utc(asOf) ? Date.parse(asOf) : NaN;
    const age = clock().getTime() - time;
    return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
  };
  return Object.freeze({
    async ask(scope, input) {
      if (!input || !Object.hasOwn(fields, input.kind) || !uuid(input.plantId) ||
          Object.keys(input).some(key => !fields[input.kind].includes(key))) fail('AI_INVALID_ASSISTANT_REQUEST');
      if (input.kind === 'ORDER' && (!uuid(input.bindingId) || typeof input.orderNumber !== 'string' || !/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(input.orderNumber))) fail('AI_INVALID_ASSISTANT_REQUEST');
      if (input.kind === 'SERVICE_METRICS' && (!utc(input.from) || !utc(input.to) || Date.parse(input.from) >= Date.parse(input.to) ||
          Date.parse(input.to) > clock().getTime() || Date.parse(input.to) - Date.parse(input.from) > 31 * 86400000)) fail('AI_INVALID_ASSISTANT_REQUEST');
      if (input.kind === 'DOCUMENTS' && (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 2000 ||
          input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 10))) fail('AI_INVALID_ASSISTANT_REQUEST');
      await authorize(scope, input.plantId);
      const response = (state, reason, evidence = null) => ({ schema: 'SCOPED_ASSISTANT_V1', kind: input.kind, state,
        reason, evidence, asOf: clock().toISOString(), generated: false, historyStored: false });
      let result;
      try {
        result = await boundedCall(async () => {
          if (input.kind === 'DOCUMENTS') {
            if (!rag?.retrieve) fail('AI_PROVIDER_UNAVAILABLE', 503);
            return rag.retrieve(scope, { plantId: input.plantId, query: input.query, limit: input.limit });
          }
          if (input.kind === 'ORDER') {
            if (!customerService?.getOrderStatusForBinding) fail('STATUS_UNAVAILABLE', 503);
            return customerService.getOrderStatusForBinding(scope, { plantId: input.plantId, bindingId: input.bindingId, orderNumber: input.orderNumber });
          }
          if (!customerService?.getMetrics) fail('STATUS_UNAVAILABLE', 503);
          return customerService.getMetrics(scope, { plantId: input.plantId, from: new Date(input.from), to: new Date(input.to) });
        }, timeoutMs);
      } catch (error) {
        if (!unavailable.has(error.code)) throw error;
        await authorize(scope, input.plantId);
        return response('ABSTAIN', 'SOURCE_UNAVAILABLE');
      }
      await authorize(scope, input.plantId);
      if (!result || !fresh(result.asOf)) return response('ABSTAIN', 'SOURCE_STALE');
      if (input.kind === 'DOCUMENTS') {
        if (result.schema !== 'SCOPED_RETRIEVAL_V1' || !Array.isArray(result.citations) || result.citations.length > 10 ||
            result.citations.some(c => c.kind !== 'DOCUMENT' || c.trust !== 'UNTRUSTED_SOURCE_CONTENT')) fail('AI_SOURCE_INVALID', 502);
        if (!result.citations.length) return response('ABSTAIN', 'NO_AUTHORIZED_EVIDENCE');
        return response('DOCUMENT_EVIDENCE', 'QUOTED_DOCUMENTS_ONLY', result);
      }
      if (input.kind === 'ORDER') {
        if (result.source !== 'PORTFOLIO_API_OWNED' || result.liveLookup !== true) return response('ABSTAIN', 'LIVE_SOURCE_REQUIRED');
        if (result.orderNumber !== input.orderNumber || !Number.isSafeInteger(result.sourceVersion) || result.sourceVersion < 1 ||
            typeof result.sourceId !== 'string' || !result.sourceId || typeof result.publicStage !== 'string') fail('AI_SOURCE_INVALID', 502);
        return response('LIVE_READ', 'AUTHORIZED_ORDER_SNAPSHOT', { source: result.source, asOf: result.asOf,
          sourceId: result.sourceId, sourceVersion: result.sourceVersion, orderNumber: result.orderNumber,
          kind: result.kind, publicStage: result.publicStage, progress: result.progress,
          milestones: result.milestones, confirmedDates: result.confirmedDates });
      }
      if (result.coverage !== 'COMPLETE' || result.truncated !== false) return response('ABSTAIN', 'INCOMPLETE_METRICS');
      if (![result.open, result.unassigned, result.overdue?.count, result.overdue?.slaMinutes].every(n => Number.isSafeInteger(n) && n >= 0) ||
          result.unassigned > result.open || result.overdue.count > result.open ||
          ['firstHumanResponse', 'resolution'].some(key => result[key] !== null &&
            (!Number.isSafeInteger(result[key]?.n) || result[key].n < 1 ||
              ![result[key].p50Minutes, result[key].p90Minutes].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)))) fail('AI_SOURCE_INVALID', 502);
      return response('LIVE_READ', 'PERSISTED_SERVICE_METRICS', { asOf: result.asOf, window: result.window,
        open: result.open, unassigned: result.unassigned, overdue: result.overdue,
        firstHumanResponse: result.firstHumanResponse, resolution: result.resolution,
        coverage: result.coverage, provenance: result.provenance, definitions: result.definitions });
    },
  });
}
