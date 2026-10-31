# PLAT-029 vendor follow-up workflow

`createVendorDraftRuntime(runtime, options?)` and `installVendorDrafts(app, service)`
are the TPR-149 composition delta. Mount after authenticated scope, origin/CSRF
protection and JSON middleware and before errors. Register `vendorDraftRoles`
explicitly, default deny; no grants or broad roles are provisioned. Call
`service.initialize()` during host initialization. No initializer executes on import.

GET `/api/ai/vendor-drafts/:draftId` reads an authorized scoped record. POST suffixes
`create`, `preview`, `approve`, `revoke`, `intent`, `dispatch`, `reconcile` implement
the named operations. Plant derives from opaque authenticated selected scope;
query and identity overrides are rejected. Command bodies use key/expectedRevision;
dispatch/reconcile use only attemptId. Domain methods validate exact fields.

Create accepts text and source `{cohort,vendorId,orderId,documentRevision,sourceHash}`.
The dedicated `ai.vendor.source.read` internal procurement permission is required
in the same foundation transaction before calling the existing approved PO reader.
No vendor impersonation or portal grant is added to operators. LEGACY and CATALOG
are explicit, with no fallback. Approved document revision/hash remain distinct
from mutable order version. Source read fences the PO header against concurrent
change and checks its legal entity when recorded; foundation binds plant/entity.
Only an authorization fence changes; no PO snapshot, amount, stock or promise changes.

Preview accepts an existing recipientGrantId or null. It resolves an actual active
VENDOR portal read grant, active user and plant/entity membership, fences all three,
and records the exact grant/user/vendor/revision/expiry/channel snapshot. Display
uses the actual portal user ID; no email or phone is invented. A missing recipient
allows preview but blocks approval. Historical source previews are labelled and
cannot be approved. Approval rechecks current document revision/hash and recipient
in the same transaction and pins previewId/contentHash/actionId with human actor/time.
Every state-changing command writes immutable full workflow revision evidence,
foundation idempotency result, audit and ID-only outbox atomically. Replays reauthorize
actor and present source access; changed payload/key conflicts. No generated text
can approve itself. Corrected text/source uses a new draft ID; prior evidence remains.

Production delivery is disabled unconditionally. The only accepted transport mode
is LOCAL_SIMULATED, injected explicitly; default transport=null. `createLocalVendorTransport`
returns deterministic labelled fixtures and performs no network operation. Intent
creation pins the exact approval/content/source/recipient and stable delivery key.
Dispatch authorizes and checks revocation/source/recipient, then commits a durable
CAS-owned attempt/lease before calling transport outside the transaction. An ambiguous
claim commit cannot invoke transport. A second dispatch cannot reclaim DISPATCHING,
UNKNOWN, ACCEPTED or confirmed attempts. Lease expiry permits reconciliation only.

Bounded timeouts, disconnects and mismatched receipts become UNKNOWN. Reconciliation
only queries the same attempt and checks provider/key/approval/hash/source/recipient
correlation. CONFIRMED requires a matched receipt; ACCEPTED stays distinct. Definite
NOT_PERFORMED is terminal for this attempt; any subsequent delivery requires a fresh
human approval/workflow (there is no automatic retry). Revocation after handoff is
recorded without asserting recall; receipts can still reconcile after revocation.
Settlement is audit/outbox/history atomic. No email/WhatsApp provider is configured,
no actual vendor send is authorized, and no SENT state is inferred.

`VendorDraftWorkspace` is the named English UI export for `/portfolio/ai/vendor-drafts`.
It uses shared portfolio fields/states, displays exact text/evidence/recipient and
approval, and only offers simulated delivery when configured. Exact pending commands
are saved in identity-scoped tab sessionStorage before POST; storage failure prevents
mutation. After ambiguity, replay uses the same command; ambiguous dispatch uses
same-attempt reconciliation, never resends. Identity changes clear displayed data.
Closing/clearing the tab loses client recovery; server records remain authoritative.
Do not register these routes without authenticated host protections.

Focused tests exercise transaction doubles and the real foundation executor, not
actual Mongo concurrency/restart or running HTTP/browser. Independent final QA,
real model/provider acceptance and shared host mounting remain separate.
