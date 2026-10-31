# Scoped AI local integration and recovery

All initializers are explicit host startup operations in an isolated environment;
none ran against a user's database during implementation. TPR-149 owns the shared
app, role map, route/navigation and startup order. Register foundation/authenticated
scope and origin/CSRF middleware first, then installRag, installAssistants,
installCustomerIntent, installVendorDrafts and installPredictions, then errors.
Pass the initialized rag instance to assistants and intent. Existing customerService
ports supply live order/metrics; no direct collection fallback is allowed. New UI
exports are AssistantWorkspace, VendorDraftWorkspace and ModelWorkspace. Contracts
under packages/scoped-ai list exact endpoints/roles/initializer inputs. No root
manifest or lockfile delta is required. Web locked dependencies were installed
locally without package/lock changes. Route mounting remains the integration gate.

Embedding adapter is explicitly configured `{model,dimensions,embed(texts,{signal})}`;
model access must be authorized separately. Default missing adapters return honest
503/abstention. Configure Qdrant with a fixed TLS or loopback origin, exact collection
and matching dimensions. API key comes from host secrets, never UI or document text.
The operator provisions its isolated collection/vector dimensions and payload indexes
before enabling the adapter; this implementation performs no cluster provisioning.
Different dimensions require a compatible configured collection; model identity is
also filtered and checked on every point. Never silently fall back to another host,
collection/model or tenant. Index initializer owns only Mongo workflow indexes.

Status checks authoritative source revision/hash/ACL and embedding model. NOT_INDEXED,
MODEL_CHANGED, SOURCE_CHANGED and REVOKED require an explicit rebuild using current
index revision and stable command key. Rebuild atomically publishes only after a
fresh authority check. Source/index revocation is immediate even with Qdrant down.
Source-bound issued PO reads require both document ACL and dedicated procurement
source permission; superseded PO revisions do not masquerade as current evidence.

Each rebuild records prior point IDs as retired (bounded to 1000; further rebuilds
stop with AI_INDEX_CLEANUP_REQUIRED). POST documents/:id/index/cleanup deletes at most
100 exact retired UUIDs via the configured adapter, then records CAS/result/audit/
outbox atomically. Active generation IDs never retire back into service and are
never reused. Lost delete acknowledgement may repeat the same IDs; lost final
commit reconciles the same key. No wildcard/filter/collection deletion exists.
Revoked index points are also eligible. The operator UI shows the count and action.

An uncertain pre-publication upsert may leave untracked inert points. They contain
only scoped references and hashes, never source text. Retrieval requires the committed
active generation and exact point list, so these are unreadable. Automatic arbitrary
orphan scanning/collection deletion is deliberately absent; reconcile provider storage
under a separately reviewed maintenance operation if required. Retired cleanup is
bounded; it is not proof of removing all unknown provider artifacts.

Vendor transport defaults disabled, and only explicit LOCAL_SIMULATED fixtures are
accepted. Approval never sends. DISPATCHING/UNKNOWN/ACCEPTED reconcile the same durable
attempt. No automatic resend, no real email/WA resolver and no live-send switch.
Revocation after handoff cannot confirm recall. See VENDOR-DRAFT-CONTRACT.md.

Model source/model adapters default unconfigured. Authorized immutable feature exports,
trained artifacts or MLflow deployment bindings are operator inputs, not invented
business facts. Local trainer uses chronological splits and source/label availability.
Version selection/rollback is scoped, CAS-protected and audited; no registry alias
or domain record changes. MLflow serving needs pinned identity gateway headers.
No model/MLflow/cloud endpoint was contacted. See MLFLOW-CONTRACT.md.

Tab recovery is tenant/plant/user scoped and persists exact commands before POST;
closing/clearing tab storage loses client recovery, never server audit/history.
Use recorded draft/attempt/command identifiers for support; do not invent a retry key.
Final QA must cover actual Mongo isolation, restart/commit ambiguity, Qdrant, mounted
HTTP and desktop/mobile/kiosk browser states, accessibility and independent model/
retrieval evaluation. Current focused doubles/compile checks are implementation
evidence only. No public push, deploy, production data operation or real send occurred.

Qdrant cleanup request syntax checked against [primary API documentation](https://api.qdrant.tech/api-reference/points/delete-points).
