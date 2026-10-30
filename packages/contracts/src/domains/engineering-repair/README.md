# Repair and quality contracts

Implementation handoff; independent acceptance is deferred to TPR-150/152.

## PLAT-013 warranty

Existing intake, diagnostic authorization, teardown, quote snapshot/decision,
deposit, execution, test/rework, QC, return, diagnostic/final invoice and settlement
contracts are preserved. New commands share the existing transaction, actor guard,
CAS, scoped idempotency, audit and outbox. All paths start `/api/repair/cases/:id`.

| Command | Additional body | Result |
| --- | --- | --- |
| `warranty` | days integer 1..3650, terms, evidence | One warranty on an accepted, QC released, returned case; UTC period begins at persisted custody return |
| `warranty-claim` | condition, evidence | Linked INTAKE case retaining customer, serial, currency and frozen warranty terms; parent response includes warrantyClaims with new case ID |
| `warranty-void` | evidence | Stops future claims; historical claims/terms preserved |

All commands require `expectedVersion` and `idempotencyKey`. Permissions are
`repair.warranty`, `repair.warranty-claim`, `repair.warranty-void` respectively;
generated roles include read plus their command. Replay reauthorizes and returns
the original result without creating another claim. Expired/void warranties fail
closed. Rejected repair scopes cannot receive warranty. Claims remain subject to
diagnosis and an approved scope; receipt alone does not authorize free work.
Historical returned cases without a recorded returnedAt cannot invent a warranty
start date. UTC business clock is used for new returns and expiry checks.

## Component authority boundary

Manufacturing prerequisite tip 693a129f04038188b0d1f52bbef6b91a0d001708 was
fast-forwarded without conflict from accepted base 0ad4248. Its stock validators
require internal execution authority for issued/consumed claims. Repair adapter
implementation requires the bounded CTO ownership amendment requested on TPR-142;
do not insert repair claims as internal executions or add another stock ledger.
