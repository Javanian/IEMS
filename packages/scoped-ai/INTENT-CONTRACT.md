# Bounded customer intent, PLAT-055

`createCustomerIntent({ foundation, rag, provider?, timeoutMs? })` is an opt-in service port. It is not mounted by this change and no model/provider is selected, contacted, or enabled. `classify(scope, { plantId, message })` accepts one current message (maximum 2,000 characters); it rejects unknown properties, including conversation history and alternate scope fields. It classifies to `FAQ`, `COMPLAINT`, `ORDER_STATUS`, or `OTHER` using bounded deterministic keyword rules.

The service checks `ai.retrieve` before and after each asynchronous boundary. It requests at most five citations through the ACL-rechecking RAG service and accepts only current `SCOPED_RETRIEVAL_V1` document citations marked `UNTRUSTED_SOURCE_CONTENT`. It has no database writes, history store, tools, recipient, send action, or retries.

Without a provider, it returns a classified result that asks an operator to review cited material. If evidence retrieval is unavailable or times out, it abstains. An optional explicitly injected `provider.summarize` has a maximum five-second call budget and receives only the current message, intent, selected citation fields, and abort signal. Provider timeout/unavailability produces a deterministic fallback. Successful output must be at most 500 characters and cite one or more supplied evidence indexes; unsupported citation or response fields are rejected. A provider configured by an integrator must have its authorization and data-sharing boundary approved separately. This package does not choose a provider or assert model quality.

Results use `CS_INTENT_V1`, state `CLASSIFIED`, `DRAFT`, `FALLBACK`, or `ABSTAIN`, and always set `historyStored: false`. `generated` is true only for schema-valid provider output; classification and fallback are not represented as model results. `DRAFT` is advisory and grants no reply/send authority. External integration must use the existing permission-aware assistant surface or agree a new API contract with its owner; this module does not add a route.

## Evidence and limits

Contract tests use in-memory authorization, RAG, and model doubles. They cover request bounds, denial after awaits, evidence absence/integrity, ignored-cancellation timeouts, no history input, single provider attempt, and citation-grounded output validation. Real provider, customer-data sharing, HTTP mounting, integrated UI, and model evaluation remain unverified and out of scope for this isolated service milestone.
# HTTP and operator integration

`apps/portfolio-api/src/cs-intent.mjs` exports `createIntentRuntime(runtime,options?)`
and `installCustomerIntent(app,intent)`. Mount authenticated POST `/api/ai/cs-intent`
with `{message}` only. Plant comes from opaque selected scope; query/identity/history
fields are rejected. It reuses the existing `ai.retrieve` grant. AssistantWorkspace
offers Customer request triage with deterministic/model labels and cited revisions.
After a model call, evidence is retrieved again; removed or changed citations abstain
instead of leaking the old summary. No provider is configured by default. Shared
registration belongs to TPR-149; no outbound response or personal history is created.
