# WhatsApp preview bridge

This package has no WhatsApp/browser adapter or session dependencies. It cannot log in, show a QR code, initialize a live adapter, fetch history/contacts, or send a message. `PREVIEWED` means local preparation only; it is not `SENT`, `DELIVERED`, or `READ`. Explicit live enablement is refused until a separately reviewed live policy and adapter are implemented. No startup greeting or automatic dispatch runs.

## Run and test

Use Node.js 24. From this directory, run `npm ci --workspaces=false --ignore-scripts`, then `npm test`. Tests start isolated MongoDB 7.0.14 single-member replica sets and disposable fixture databases. The first run downloads and caches the MongoDB binary. To use an installed binary, set `MONGOMS_SYSTEM_BINARY` to its absolute path; set `MONGOMS_RUNTIME_DOWNLOAD=false` for offline operation. Tests never attach to an existing database or WhatsApp session. Crash recovery tests kill only child workers they created and identified.

`npm start` requires explicit environment configuration, never loads `.env` automatically:

- `WA_MONGO_URI`: loopback Mongo URI with an explicit port and path.
- `WA_DB_NAME`: `iems_wa_bridge_owned_<suffix>` with ownership document `{_id: 'wa-bridge', synthetic: true}` provisioned by the owner.
- `WA_TENANT`, `WA_ACCOUNT`: one configured synthetic tenant and opaque account.
- `WA_SERVICE_SECRET`, `WA_APPROVAL_KEY`: separate secrets, each at least 32 characters. Never send either to a browser. The approval key stays with the trusted approval issuer; there is no token-minting HTTP endpoint.
- `WA_PARTICIPANTS`: comma-separated opaque verified participant IDs, empty by default.
- `WA_RECEIVE_PREVIEW=true`: explicitly enable synthetic inbound processing; default disabled.
- `WA_PORT`: default 3047, binds only `127.0.0.1`.
- `WA_LIVE_ENABLED`: any non-false value hard fails startup.

Use a dedicated local owned database. Never point this package at a shared application database or copy personal WhatsApp sessions. Library `createBridge` accepts an already-owned Mongo Db for embedding/testing; caller owns transport binding and DB ownership checks. The shipped process enforces both.

## HTTP contract

Service routes require `Authorization: Bearer <service secret>`, except the public `GET /health` DB ping. Operator POST routes (`/bindings`, `/bindings/revoke`, `/prompts`, `/session`, `/session/pause`, `/session/resume`) instead require a real foundation session bearer with the configured adapter. Service credentials do not grant operator authority; foundation credentials do not grant service delivery access. Bodies are capped at 16 KiB. Error responses contain fixed codes, not input or DB errors. Request bodies, opaque IDs, tokens and secrets are not logged. Loopback is not a substitute for service authentication; keep the service secret server-side.

- `GET /status`: mode, receive switch, pause, aggregate ignored count and queue size; never claims live readiness.
- `GET /session`: scoped opaque participant session metadata, no activation hash/code.
- `POST /session`: `{recipient, code, expiresAt}` creates an inactive explicit session with increasing version. Code is 8-64 alphanumeric/underscore/hyphen chars. Lifetime at most 2 hours; inactivity 15 minutes. Replacing a session cancels queued approvals. Disallowed while paused.
- `POST /inbound`: `{metadata:{tenant,account,recipient,kind:'direct',eventId,history:false,fromMe:false,broadcast:false},text}` is synthetic preview input, not a provider webhook. All metadata eligibility gates precede reading the body accessor/persistence. Only allowlisted participants with an explicit unexpired session may activate with exact `IEMS DEMO <code>`. Ordinary private text is ignored even after activation. Only `IEMS ` commands are stored; activation text is not a transcript. `IEMS STOP` deactivates and cancels pending previews. Duplicate eligible event IDs are unique within tenant/account. When the optional customer-service port is enabled, eligible commands enqueue domain replies for explicit local preview; no provider message is sent.
- `POST /session/pause`: durable global pause, deactivate/version sessions, cancel queued previews.
- `POST /session/resume`: explicit pause release only, no session reactivation or stale approval revival.
- `POST /messages`: `{recipient,key,text,authorization}` creates a durable `QUEUED` preview. Requires separately signed explicit approved-preview authorization, active session and current version. Same key/same payload returns the same ID; a changed payload or nonce reused for another action conflicts (409).
- `GET /messages/:id`: status only, no body; reconciles stale queued authorization.
- `POST /messages/:id/preview` with `{}`: explicit local preview. Rechecks session version, pause, approval/session expiry. Produces `PREVIEWED` or `CANCELLED`, never provider success. Repeats preserve terminal state.
- `POST /session/live`: always 403 `LIVE_POLICY_NOT_INTEGRATED`.

## Foundation operator authentication

`WA_OPERATOR_ADAPTER=foundation` explicitly selects the actual public tenant-foundation implementation. Set `WA_FOUNDATION_DB_NAME=iems_wa_bridge_owned_identity` (separate from the bridge DB), with owner-provisioned `{_id:'wa-bridge-foundation', synthetic:true}` in its ownership collection, and `WA_PLANT_ID` to the foundation UUID plant. `WA_TENANT` must be the foundation UUID tenant. Both databases must share the configured local Mongo replica set/client. No automatic user, membership, session, personal provider or credentials are created. The owner provisions identities using foundation public APIs and issues an opaque session token; only its hash is persisted by foundation. The CLI never logs it. Unset adapter defaults to `none`, mutation failclosed; unknown adapters refuse startup.

Example Git Bash startup after owner provisioning (secrets/session issuance are outside this shell example):

```bash
WA_MONGO_URI='mongodb://127.0.0.1:27047/?replicaSet=owned' \
WA_DB_NAME=iems_wa_bridge_owned_preview \
WA_FOUNDATION_DB_NAME=iems_wa_bridge_owned_identity \
WA_OPERATOR_ADAPTER=foundation WA_TENANT="$OWNED_TENANT_UUID" \
WA_PLANT_ID="$OWNED_PLANT_UUID" WA_ACCOUNT=preview \
WA_SERVICE_SECRET="$OWNED_SERVICE_SECRET" WA_APPROVAL_KEY="$OWNED_APPROVAL_KEY" \
WA_PARTICIPANTS=synthetic-contact WA_RECEIVE_PREVIEW=true npm start
```

`bridgeAdmin` grants `wa.preview.binding.create`, `binding.revoke`, `session.create`, `policy.pause`, `policy.resume`, `prompt.create` (each with `wa.preview.`). `bridgeReader` grants no mutations. Grants must cover the selected configured plant; foreign tenants/plants and conflicting scope aliases are denied. Foundation authenticates and authorizes each operator request, then conditional membership-version/session write fences join the bridge transaction. Revocation/version changes conflict and retry, expiry is checked again at that fence. Authorization linearizes there; expiry after a successful fence does not retroactively invalidate a committed action. No tenant-foundation source files changed.

Primary acceptance is `test/foundation.test.mjs`: actual foundation-issued bearer sessions, owned real Mongo and HTTP create/revoke/prompt; two tenants, roles, revoked sessions/memberships, stale membership version, expiry and controlled in-flight races. The older synthetic actor adapter remains only a lower-level regression seam, never CLI configuration or final authentication evidence.

- `POST /bindings`: `{recipient, customer, synthetic:true, expectedVersion:0}`. Creates immutable customer identity/version 1 after scope authorization. Existing identity cannot be reassigned or revived through HTTP.
- `POST /bindings/revoke`: `{recipient, expectedVersion}`. Increments binding version, marks inactive, deactivates session and cancels queued work in the same transaction. Session enrollment now requires this trusted active binding.
- `POST /prompts`: `{recipient, sessionVersion, expiresAt}`. Registers a local preview prompt UUID, lifetime at most five minutes and no later than session expiry. No provider prompt is sent or invented. Exact `metadata.replyTo` can authorize one bounded unprefixed answer only for that tenant/account/contact/session/binding version. Unknown/stale/consumed prompt IDs are rejected before the lazy body accessor; consumption and accepted inbox persistence are atomic. Prefix-only commands remain bounded by active session. STOP is never stored as transcript.

## Customer service integration (preview only)

`createBridge({ customerService })` accepts a `@iems/customer-service` instance (`file:../../packages/customer-service` dependency in this package's own lock). The CLI enables it only with `WA_CUSTOMER_SERVICE=enabled` **and** `WA_OPERATOR_ADAPTER=foundation`; customer-service then shares the owned foundation database (`cs_*` collections) and `WA_TENANT` must be a UUID. Set `WA_ACCOUNT=SIMULATED` for this mode; another channel account is refused at startup. Any other value, or `enabled` without the foundation adapter, refuses startup. Without the option nothing changes.

- **Inbound**: accepted `IEMS ...` commands (same metadata/session/binding gates as before) are routed after the inbox commit. Principal = `resolveCustomerPrincipal({tenantId: WA_TENANT, channelAccountId: WA_ACCOUNT, providerContactId: recipient})`; the domain binding must exist (admin fixture) in addition to the bridge's synthetic binding. Commands: `IEMS MENU`, `ORDER <no>`, `TICKET <no>`, `HUMAN`, `COMPLAINT`, `COMPLAINT ORDER <no>|GENERAL`, `COMPLAINT CATEGORY <CAT>`, `COMPLAINT DESCRIBE <text>`, `COMPLAINT BACK|CANCEL`, `COMPLAINT CONFIRM`. The HTTP/`inbound()` result gains `cs` (draft view, ticket number after commit, reply state, mode, or a fixed error code). Event ID is the domain idempotency key, so a duplicate event returns the stored result and creates no second ticket. The domain persists the active draft pointer with the inbound result.
- **Handoff**: `IEMS HUMAN`, a `SAFETY_OR_DAMAGE` complaint or an operator takeover moves the conversation off `BOT_ACTIVE`; queued bot replies are cancelled in the domain transaction and later bot replies return `SUPPRESSED` with no outbox row. Only deduplicated acks and explicit operator replies are previewed.
- **Dispatcher**: `POST /cs/dispatch` (service bearer, empty body) claims one delivery for the configured tenant and account. The body must be `{}`; any body field or `x-tenant-id`/`x-plant-id`/`x-channel-account`/`x-account` header is 403 `CALLER_SCOPE_FORBIDDEN`. Lease owner and `preview` mode are fixed server-side. Global pause is 403; an inactive/expired bridge session or revoked bridge binding turns the claimed row into a local `CANCELLED` preview. A local preview row (`cs_previews`, unique per delivery) is written with `PREVIEWED`, `providerMessageId: null`, `LOCAL_PREVIEW_NO_PROVIDER_CALL`; the domain outbox row completes as `PREVIEWED` when the service uses `previewDispatcher: true`, with no provider receipt or send timestamp.
- **UNKNOWN**: test-only `bridge.dispatchCustomerService('ambiguous')` records `UNKNOWN` (`SUBMIT_UNCERTAIN`); it is not HTTP-reachable. UNKNOWN blocks later rows of that conversation, expired `SENDING` leases are reconciled to `UNKNOWN` before every claim, and even an evidenced operator requeue cannot create a second preview for the same delivery (`cs_previews` unique index; the requeued attempt is closed without re-preview).
- **Live**: no provider code exists. `liveEnabled` still throws `LIVE_POLICY_NOT_INTEGRATED` and `/session/live` is 403.

The domain now persists inbound commands atomically and has a terminal `PREVIEWED` outcome. Order lookup requires an injected authoritative reader; fixtures remain explicitly synthetic. The standalone CLI does not configure a live order reader.

## Approval format

`signDelivery(claims, approvalKey)` is exported for a trusted independent issuer/test harness, not an operator browser. It signs base64url JSON with HMAC SHA256. Claims:

```
{kind:'operator-approved-preview',tenant,account,recipient,
 contentHash:contentHash(text),approvalVersion:sessionVersion,
 expiresAt:epochMilliseconds,key:idempotencyKey,nonce:uniqueActionNonce}
```

Maximum token lifetime on admission is 5 minutes. Content hash covers exact UTF-8 text. Tenant/account come from trusted process config; input cannot override them. Session version binds approval to an explicitly activated session; durable synthetic binding version/customer are captured separately and rechecked inside dispatch transactions. Neither is proof of real customer authorization. A valid token replay for the same logical payload is an idempotent read, not a second delivery; replay with another key is denied by durable nonce uniqueness.

## Recovery and limitations

Mongo unique indexes hold inbound dedup and outbox key/nonce constraints across bridge restarts. Queue is retained rather than TTL-deleted. Startup converts any legacy/simulated `SENDING` record to `UNKNOWN`, never blind retries, and cancels expired/stale queued work. Local `dispatch(id,'ambiguous')` is an explicit test-only provider outcome simulator returning `UNKNOWN` with `SIMULATED_PROVIDER_TIMEOUT_NOT_LIVE`. It makes no provider call and is not exposed over HTTP. Only `preview` and `ambiguous` labels are accepted.

Authorization transitions, eligible inbox persistence, queue admission and local preview now use Mongo replica-set transactions contending on one configured scope policy document. STOP/Pause cannot commit between authorization and a local preview state transition. This serialization is intentionally bounded to this preview account, not a throughput claim. Session expiry and allowlist/receive configuration are rechecked for queued work. Unknown own outgoing on an allowed direct conversation deactivates it and cancels queued work without reading content; a new explicit session/activation is required. There are no known app-generated provider IDs because there are no provider calls.

This is a standalone preview slice, not full WA acceptance, a live order integration, retention implementation, browser/account isolation, public production login, or a live delivery lease/receipt system. Actual tenant-foundation session authentication is integrated for the owned preview operator API; synthetic customer binding and single-use known-prompt scope remain preview-only. The synthetic HTTP endpoint necessarily parses its bounded JSON envelope including `text`; the lazy body privacy gate applies to `inbound(meta, readBody)` and no ignored content is durably stored or logged. A future provider must call that lazy interface only after metadata extraction, not forward private content through this HTTP fixture endpoint. Any future live adapter requires remote-call fencing, conversation modes and independent acceptance. No provider guarantees or exactly-once delivery claims are made.

## Prompt body privacy (PLAT-051)

Known-prompt answers now persist only a scoped receipt with prompt/session/binding versions and bodyRetained:false. No raw answer, body hash or derived answer is retained or sent to customer-service. Prompt consumption and the metadata receipt remain atomic. Explicit prefixed commands retain the existing scoped CS command contract. Historical preview rows are unchanged; this change does not erase existing data. The synthetic HTTP envelope still parses a bounded body in memory. Live browser/provider support remains unimplemented and disabled.

## Provider callback envelope contract (PLAT-047/051)

`src/provider-callback.mjs` exports `createProviderCallbackVerifier`. Trusted configuration supplies tenant UUID, account ID, a separate callback key as a Buffer of at least 32 bytes, and a clock. The adapter must bound raw request bytes before buffering; verifier accepts at most 4096 bytes. HMAC SHA256 covers `timestamp + "." + rawBody` (UTF-8 timestamp, exact request bytes), encoded as 64 lowercase hex characters. Timestamp is epoch milliseconds, within five minutes of server time. Never use service/approval keys as callback keys.

Authenticated JSON must contain exactly version (1), tenantId, accountId, eventId, deliveryId (UUID), providerMessageId and status (ACCEPTED/DELIVERED/FAILED). Unknown fields, including bodies/notes, are rejected. The returned frozen object is metadata only. Authentication is not event consumption: the eventual handler must transactionally deduplicate eventId, bind deliveryId/providerMessageId to the configured account and session generation, enforce monotonic terminal states and preserve UNKNOWN until evidence reconciles it. A fresh signature must never authorize resending an ambiguous delivery.

This module is unmounted and makes no provider calls. HTTP wiring, durable callback processing, single browser ownership and provider integration remain incomplete. Live send remains disabled. The pure contract checks use synthetic envelopes and do not establish provider or Mongo acceptance.

`src/provider-reconciliation.mjs` now supplies an unmounted callback consumer. It verifies each envelope before an injected replica-set transaction, requires a pre-registered scoped delivery, pins the provider message ID, consumes metadata-only event IDs atomically with a revision CAS, and rejects conflicting replays or terminal receipts. Late ACCEPTED events cannot regress DELIVERED/FAILED. UNKNOWN is resolved only by authenticated receipt evidence; this module has no send method. A duplicate returns the current delivery state and never writes another event.

Integration must explicitly call `initializeProviderReconciliation(db)` before accepting callbacks, supplying unique event/delivery/provider-message indexes. This initializer is declared but has not been executed. The transaction dependency must commit/rollback all collection operations together and handle Mongo transient transaction conflicts with bounded retry; ambiguous commit outcomes must be reconciled using the same event ID. Delivery registration/session generation fencing, session ownership, HTTP wiring and actual provider receipts remain incomplete. No preview outbox records are treated as registered live deliveries. Run the bounded synthetic contract checks explicitly with `node --test apps/wa-demo-bridge/test/provider-callback.test.mjs apps/wa-demo-bridge/test/provider-reconciliation.test.mjs`; Mongo uniqueness/concurrency and provider acceptance remain final QA work.

## Session and delivery registration boundary (PLAT-047)

`src/provider-session.mjs` supplies an unmounted internal registry. Trusted configuration fixes tenant/account; acquire exclusively reserves one owner and monotonically increasing generation. An active owner cannot be acquired again, including by the same owner. There is no timeout takeover. Release requires the owner/generation plus an internal assertion that its adapter has closed. That assertion must come from successful browser teardown, never an HTTP body. A crashed or ambiguous acquire/close stays reserved pending operator reconciliation of the owned browser/process; do not automatically release or start another browser. This registry alone does not open, close or isolate a browser.

Registration validates UUID delivery/reply IDs and the current owned generation in one transaction. Its required `authorizeRegistration(input, session)` dependency must reauthorize and fence current reply, identity, approval, allowlist, prefix, expiry and pause policy in that same transaction, returning exactly true. A permissive stub is not a live policy implementation. Registration contends with release on the session document. Unique scope/reply and scope/delivery indexes prevent another delivery for an ambiguous reply. Replays reauthorize, return the existing state and never reset an attempt; a different reply or session generation cannot reuse a delivery. Only metadata is retained. SENDING denotes a reserved attempt, not evidence that a provider was called. A failure after registration must retain the original ID and reconcile; never derive a new ID and resend. Historical receipts can reconcile a registered old-generation delivery after browser closure; they do not authorize new work in that generation.

Integration must run both `initializeProviderSessions(db)` and `initializeProviderReconciliation(db)` before accepting registrations/callbacks. Neither initializer has been executed here. Use bounded transaction retry only for known aborted transactions and same-ID reconciliation for ambiguous commits. No registry method sends, and ready events have no dispatch hook. Browser lifecycle orchestration, actual policy dependency, callback HTTP mount and provider integration remain incomplete; external send is disabled. Synthetic checks: `node --test apps/wa-demo-bridge/test/provider-session.test.mjs apps/wa-demo-bridge/test/provider-callback.test.mjs apps/wa-demo-bridge/test/provider-reconciliation.test.mjs`. Real Mongo contention, index enforcement and browser recovery await final QA.
# Provider lifecycle boundary

`src/provider-lifecycle.mjs` wraps an injected registry and adapter with explicit
start/stop operations. Durable acquisition precedes open; a confirmed
`{ closed: true }` close precedes release. Overlapping operations are rejected.
Any uncertain acquire, open, close or release enters `UNKNOWN`, retains the
reservation and requires operator reconciliation; there is no automatic retry,
reacquire or timeout takeover. The adapter receives only frozen ownership
metadata, with no ready dispatch hook or send capability. External send remains
disabled. This boundary is not mounted and supplies no browser/provider driver.

`createBridge` optionally accepts `providerCallbacks: { secret: Buffer }` to mount
`POST /provider/callback`. Default is disabled (404). This separate HMAC key is
not the preview bearer secret. The reconciler is bound to the configured tenant
and account and uses the bridge transaction; initialize provider indexes before
enabling it. Only exact `application/json`, identity encoding, at most 4096 bytes,
`x-iems-timestamp` and `x-iems-signature` are accepted. Authenticate exact bytes
before metadata parsing; no private bodies are stored or logged. Conflict returns
409; uncertain storage failure returns 503 without retry. The provider must retain
the event/delivery IDs when reconciling a failed acknowledgement. Callbacks may
reconcile registered deliveries while paused; they never authorize dispatch.
This does not enable live mode, register deliveries, or open a browser. Policy and
browser integration remain incomplete. HTTP contract checks use in-memory streams;
real HTTP/Mongo/provider and independent QA remain NOT_RUN.

`src/provider-policy.mjs` supplies the registration evaluator for
`authorizeRegistration`. Its `readAndFence(request, session)` dependency must
load current scoped policy, identity, binding, approval and reply metadata and
write-fence their revocation authorities in that same registration transaction.
Never pass caller snapshots or preview collections as live authority. The
evaluator checks explicit approval, customer/recipient binding, identity/binding
versions, content hash, configured command prefix, allowlist, pause and expiry
on every call, including receipt replay. It accepts metadata only and does not
read or persist message text. `commandPrefix` must be attested by the trusted
command parser; it is not proof that arbitrary text has that prefix.
The evaluator is not mounted: the durable live authority provisioning/read-and-
fence adapter and browser driver remain incomplete. No live mode is enabled.
Synthetic contract checks: `node --test apps/wa-demo-bridge/test/provider-policy.test.mjs`.
