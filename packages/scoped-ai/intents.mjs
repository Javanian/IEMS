import { boundedCall, fail, scopeTarget, uuid } from './indexing.mjs';

const inputKeys = ['plantId', 'message'];
const classify = message => {
  const text = message.toLowerCase();
  if (/\b(complaint|complain|unhappy|damaged|defect|wrong item|not received|late delivery)\b/.test(text)) return 'COMPLAINT';
  if (/\b(where is|status of|track|tracking|delivery status|order status)\b/.test(text)) return 'ORDER_STATUS';
  if (/\b(what is|how do|how to|can i|do you|does)\b/.test(text)) return 'FAQ';
  return 'OTHER';
};

export function createCustomerIntent({ foundation, rag, provider = null, timeoutMs = 3000 }) {
  if (!foundation?.authorize || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 ||
      provider !== null && typeof provider?.summarize !== 'function') fail('AI_ADAPTER_CONFIGURATION', 500);
  const authorize = (scope, plantId) => foundation.authorize(scope, scopeTarget(scope, plantId, 'ai.retrieve'));
  return Object.freeze({
    async classify(scope, input) {
      if (!input || Object.keys(input).some(key => !inputKeys.includes(key)) || !uuid(input.plantId) ||
          typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000 || input.message.includes('\0')) {
        fail('AI_INVALID_INTENT_REQUEST');
      }
      await authorize(scope, input.plantId);
      const intent = classify(input.message);
      let retrieval;
      try {
        retrieval = await boundedCall(signal => {
          if (!rag?.retrieve) fail('AI_PROVIDER_UNAVAILABLE', 503);
          return rag.retrieve(scope, { plantId: input.plantId, query: input.message, limit: 5, signal });
        }, timeoutMs);
      } catch (error) {
        if (!['AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE', 'AI_EMBEDDING_UNAVAILABLE'].includes(error.code)) throw error;
        await authorize(scope, input.plantId);
        return { schema: 'CS_INTENT_V1', intent, state: 'ABSTAIN', reason: 'EVIDENCE_UNAVAILABLE',
          summary: 'No authorized evidence is available. Review the request manually.', citations: [], generated: false, historyStored: false };
      }
      await authorize(scope, input.plantId);
      if (!retrieval || retrieval.schema !== 'SCOPED_RETRIEVAL_V1' || !Array.isArray(retrieval.citations) ||
          retrieval.citations.length > 5 || retrieval.citations.some(c => c.kind !== 'DOCUMENT' || c.trust !== 'UNTRUSTED_SOURCE_CONTENT' ||
            !uuid(c.resourceId) || !Number.isSafeInteger(c.sourceRevision) || !Number.isSafeInteger(c.aclRevision) ||
            !Number.isSafeInteger(c.indexRevision) || typeof c.title !== 'string' || typeof c.text !== 'string' || c.text.length > 4000)) {
        fail('AI_SOURCE_INVALID', 502);
      }
      if (!retrieval.citations.length) return { schema: 'CS_INTENT_V1', intent, state: 'ABSTAIN', reason: 'NO_AUTHORIZED_EVIDENCE',
        summary: 'No authorized evidence supports a response. Review the request manually.', citations: [], generated: false, historyStored: false };

      if (!provider) return { schema: 'CS_INTENT_V1', intent, state: 'CLASSIFIED', reason: 'MODEL_UNAVAILABLE',
        summary: `Classified as ${intent.toLowerCase()}. Review the cited material before responding.`,
        citations: retrieval.citations, generated: false, historyStored: false };

      let draft;
      try {
        draft = await boundedCall(signal => provider.summarize({ intent, message: input.message,
          evidence: retrieval.citations.map(({ resourceId, sourceRevision, title, text }) => ({ resourceId, sourceRevision, title, text })), signal }), timeoutMs);
      } catch (error) {
        if (error.code !== 'AI_PROVIDER_TIMEOUT' && error.code !== 'AI_PROVIDER_UNAVAILABLE') throw error;
        await authorize(scope, input.plantId);
        return { schema: 'CS_INTENT_V1', intent, state: 'FALLBACK', reason: 'MODEL_UNAVAILABLE',
          summary: `Classified as ${intent.toLowerCase()}. Review the cited material before responding.`,
          citations: retrieval.citations, generated: false, historyStored: false };
      }
      await authorize(scope, input.plantId);
      if (!draft || Object.keys(draft).some(key => key !== 'summary' && key !== 'citationIndexes') ||
          typeof draft.summary !== 'string' || !draft.summary.trim() || draft.summary.length > 500 ||
          !Array.isArray(draft.citationIndexes) || !draft.citationIndexes.length || draft.citationIndexes.length > 5 ||
          draft.citationIndexes.some(i => !Number.isSafeInteger(i) || i < 0 || i >= retrieval.citations.length) ||
          new Set(draft.citationIndexes).size !== draft.citationIndexes.length) fail('AI_MODEL_OUTPUT_INVALID', 502);
      return { schema: 'CS_INTENT_V1', intent, state: 'DRAFT', reason: 'CITED_MODEL_SUMMARY', summary: draft.summary,
        citations: draft.citationIndexes.map(i => retrieval.citations[i]), generated: true, historyStored: false };
    },
  });
}
