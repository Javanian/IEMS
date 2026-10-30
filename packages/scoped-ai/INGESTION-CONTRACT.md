# Document ingestion and retrieval — PLAT-027

Current source is manual plain text authored by an authorized operator, not extracted or validated against a business document/PDF. `MANUAL_TEXT` provenance is persisted. No URL fetching, remote file execution, hidden personal history, synthetic production text or fabricated model response exists. PDF/OCR extraction and binding to issued business artifacts are not yet implemented.

`createAiDocuments` provides the concrete authoritative source adapter for the scoped index. Ingestion publishes a UUID document, title, deterministic plain-text chunks and an explicit per-user ACL. Each reader must have an active user and tenant membership covering the selected plant/legal entity; user and membership writes fence concurrent revocation. No membership or foundation role is granted. All changes use foundation command authorization/replay, expected revisions, atomic result/audit/outbox and bounded transaction handling. Changes increment content/ACL revisions; previous index generations abstain until rebuilt. Revocation makes source reads fail immediately even if Qdrant is unavailable. This collection is a document store, not a financial/domain ledger.

Source reads verify current tenant, plant, legal entity, per-user ACL, active status and content hash and fence the same document in the retrieval transaction. A source supplied by another module must preserve these guarantees rather than reusing manual text authority for copied business documents. Original business artifact access must still be rechecked by that binding; no such binding is claimed here.

The installer in `apps/portfolio-api/src/rag.mjs` exports `ragRoles`, `createRagRuntime(runtime, {embeddings, vectors})`, and `installRag(app, rag)`. CTO TPR-149 owns registration in the authenticated app, role map, shared routes/manifest, body size limit (at least 110 KiB, hard capped) and lifecycle. The installer expects the existing authenticated `req.scope`, performs selected-scope alias checks, rejects unknown mutation fields, validates resource UUIDs and emits `Cache-Control: no-store`.

Endpoints:

- GET `/api/ai/documents`: current reader-visible metadata, capped at 50, honest coverage.
- PUT `/api/ai/documents/:id`: `{key, expectedRevision, title, text, allowedUserIds}`; revision 0 creates, subsequent CAS replaces.
- POST `/api/ai/documents/:id/revoke`: `{key, expectedRevision}`; revokes authoritative source and ACL.
- POST `/api/ai/documents/:id/rebuild`: `{key, expectedRevision}`; expected **index** revision, distinct from document revision.
- POST `/api/ai/retrieve`: `{query, limit?}`; revision/ACL checked evidence, never an asserted live order state.

Provider configuration is optional for document persistence. Retrieval/rebuild return `AI_PROVIDER_UNAVAILABLE` 503 until explicitly authorized embedding/vector adapters are supplied. No model access, results, enrollment or cloud acceptance is assumed. Underlying factory index initialization is explicit, not run in this implementation. Read-only index revision/status endpoint, ingestion/assistant UI, issued-document extraction binding, generation cleanup and evaluation suite remain subsequent work; this milestone does not complete PLAT-027/044 or the issue.

Minimum evidence: source/ACL and indexing tests use in-memory database doubles plus real foundation command code; Qdrant transport tests use fetch responses. They do not prove Mongo transactions, concurrent revocation, actual provider results or HTTP/browser acceptance. Independent evaluations remain deferred to TPR-150/152 on the integrated candidate.
