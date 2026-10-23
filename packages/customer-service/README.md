# Customer service domain

Durable complaints, tickets, operator handoff and delivery outbox on MongoDB. The sibling WhatsApp preview bridge uses this package for inbound commands and local previews. This branch does not mount the domain in the main application API or connect a live messaging provider.

## Data provenance

- Customers, contact bindings and order snapshots are admin-registered **synthetic fixtures** (`synthetic: true`, `verifiedMethod: 'ADMIN_FIXTURE'`).
- `getOrderStatusForCustomer` returns `source: 'SYNTHETIC_FIXTURE_SNAPSHOT'` and `liveLookup: false`. It is not an order-domain integration. Replace the snapshot reader with the scoped order API before claiming live order status.

## Public contract (`index.mjs` + `index.d.ts`)

`createCustomerService({ client, db, foundation })` takes a real MongoClient/Db and the `@iems/tenant-foundation` instance (only `authorize` is used, read-only).

| Port | Caller | Authorization |
| --- | --- | --- |
| `resolveCustomerPrincipal` | trusted bridge | tenant from configured channel account; active binding `(tenant, channelAccount, providerContact)` only |
| customer methods (`startComplaintDraft`, `updateComplaintDraft`, `confirmComplaint`, `getTicketForCustomer`, `addCustomerComment`, `getOrderStatusForCustomer`, `enqueueBotReply`, `requestHandoff`) | bridge on behalf of a bound contact | opaque `CustomerPrincipal` from a WeakMap registry; binding status and version rechecked on every call |
| operator methods | authenticated host application | tenant-foundation `VerifiedScope` + target `plantId` + action (`cs.ticket.read`, `cs.ticket.write`, `cs.note.internal`, `cs.conversation.handoff`, `cs.reply`, `cs.ticket.reopen_closed`, `cs.delivery.review`, `cs.fixture.admin`) |
| `claimNextDelivery`, `recordDeliveryResult`, `reconcileExpiredSending` | single trusted dispatcher per channel account | tenant + channel account; never exposed to browsers |

Errors are `CustomerServiceError` with `code` and `status`; tenant-foundation denials surface as `ScopeDenied` (`SCOPE_DENIED`). Not-found and not-yours both return `NOT_FOUND`.

## Rules implemented

- **Draft stages** `ORDER_SELECTION → CATEGORY → DESCRIPTION → PREVIEW → CONFIRMED`, with `BACK`, `CANCEL`, 24 h expiry and optimistic `expectedVersion`. Order selection only accepts the customer's own snapshot.
- **Confirmation** commits ticket, `CREATED` history event, conversation `activeTicketId`, `TICKET_ACK` outbox row, idempotency record and audit in one snapshot/majority transaction. Ticket number (`CS-000001`, per tenant counter) is returned only after commit. Idempotency key = `(tenant, scope, binding, inboundKey)` with SHA-256 canonical request hash; same key + different request → `IDEMPOTENCY_CONFLICT`. A confirmed draft returns the same ticket for any later key. Unique `draftId` index backs concurrent duplicates.
- **Ticket stages** `NEW, TRIAGED, ASSIGNED, IN_PROGRESS, WAITING_FOR_CUSTOMER, RESOLVED, REOPENED, CLOSED` with an explicit transition table, required reason, actor, version CAS and history row per change. Reopening `CLOSED` needs `cs.ticket.reopen_closed`. No automatic closure.
- **Internal notes** live in `cs_internal_notes`, never in `cs_ticket_events`; customer projection reads only customer-visible events.
- **Conversation modes** `BOT_ACTIVE, HUMAN_PENDING, HUMAN_ACTIVE, PAUSED, CLOSED` with version CAS and `modeEpoch`. Any move away from `BOT_ACTIVE` cancels QUEUED bot replies in the same transaction and reports SENDING/UNKNOWN rows as `inFlightDeliveryIds` (not retractable). Bot replies are `SUPPRESSED` outside `BOT_ACTIVE`. `SAFETY_OR_DAMAGE` complaints go straight to `HUMAN_PENDING`. Resume is explicit only.
- **Outbox** `QUEUED → SENDING → SENT | FAILED | UNKNOWN | CANCELLED`. Claim writes SENDING with lease and incremented fence before any remote call; per-conversation FIFO by monotonic `seq`; a conversation with SENDING/UNKNOWN is blocked. Dispatch rechecks binding version, mode, epoch, operator assignee and expiry, cancelling stale rows. Stale fences are rejected. Expired SENDING and post-submit timeouts become UNKNOWN; only an authorized evidence-based review (`cs.delivery.review`) can mark it SENT, requeue it, or abandon it. `NOT_SENT` (proven pre-submit) retries with backoff up to `maxSendAttempts`, then FAILED.
- Binding revocation cancels queued deliveries and invalidates existing principals.

Collections: `cs_customers, cs_contact_bindings, cs_order_snapshots, cs_complaint_drafts, cs_tickets, cs_ticket_events, cs_internal_notes, cs_conversations, cs_conversation_events, cs_outbox, cs_idempotency, cs_counters, cs_audit`. Names coexist with tenant-foundation's collections in one owned database.

## Verification

From this directory:

```
npm ci --ignore-scripts --workspaces=false
npm test
npm run typecheck
```

Use Node.js 24. Tests start isolated single-member MongoDB replica sets, create disposable databases, then drop those databases and stop their own processes. MongoDB 7.0.14 is downloaded and cached on the first test run. For an existing binary, set `MONGOMS_SYSTEM_BINARY` to its absolute path; set `MONGOMS_RUNTIME_DOWNLOAD=false` to prohibit downloads. There is no dependency on the local experiment workspace or a shared PostgreSQL instance. These tests do not establish high availability.

## Not claimed

Live customer order connectivity, main application HTTP routes, provider send/receipts, n8n reminders, retention jobs, UI, multi-node availability or production readiness. An injected order reader is tested with controlled fixtures; a passing fixture is not live integration evidence.

## Inbound and preview contract

- Order status uses an injected `orderReader` (`readCustomerOrder`), with `orderReaderTimeoutMs` (default 2000) and `orderMaxStaleMs` (default 60000). Throw, timeout, wrong source or stale/future `asOf` returns `STATUS_UNAVAILABLE`; `null` returns `NOT_FOUND`. Without a reader, status is refused unless `allowSyntheticOrders: true`.
- `handleInboundCommand(principal, {inboundKey, text, command})` records inbound text, applies the domain change, enqueues the versioned template reply, moves the conversation `activeDraftId` and stores the result in one transaction. Replays return the stored result.
- `PREVIEWED` is a terminal delivery state accepted only from a service created with `previewDispatcher: true`. It never sets `providerMessageId` or `sentAt`.
- Operator reads: `listTicketsPage`, `listConversationsPage`, `getConversationThread` (opaque cursor, limit 1..100). Internal notes are never part of a thread.
- Resolving a ticket enqueues a `TICKET_RESOLVED` customer delivery.
- `faultInjector(boundary)` is a test hook for `domain`, `pointer`, `result` and `afterCommit`.

## Operator bindings and metrics

`createBinding` verifies the customer/contact through an injected `partyDirectory`. This version accepts the `SIMULATED` channel and reserved synthetic addresses only. Binding creation, expiry and revocation have permission, version and idempotency checks. `simulateInbound` requires `cs.simulator.use`; the preview dispatcher records `PREVIEWED` without a provider receipt. Scoped metrics report ticket counts and observed response timing from persisted events.
