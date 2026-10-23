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
