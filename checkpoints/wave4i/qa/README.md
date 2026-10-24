# Independent QA preparation — NOT runtime proof

Status: LIGHT PREPARATION ONLY. B retains exclusive heavy token. Probe authored after inspecting CONTRACT.md, HANDOFF.md, agent-a.md, actual API and existing tests. No Mongo, browser, renderer, dependency installation or test execution performed. No RED/GREEN assertion result claimed. Source references below are inspection evidence, not passing proof.

## Runnable after lead explicitly grants heavy token

Git Bash, Node 24, already-installed API/renderer dependencies and approved local Mongo system binary required. Do not run against shared Mongo/PostgreSQL or supply a connection URI. The probe only uses the existing owned replica helper. Its early token check precedes dynamic application/Mongo imports.

```bash
cd 'D:/Project AI/GITHUB/IEMS-worktrees/crm-order-management'
export TMPDIR='C:/Users/Admin/AppData/Local/hermes/cache/scratch'
mkdir -p "$TMPDIR/wave4i-qa"
# Set MONGOMS_SYSTEM_BINARY to the lead-approved existing mongod executable if needed.
# Lead must explicitly transfer the exclusive heavy token before this command:
WAVE4I_QA_HEAVY_TOKEN=lead-granted node --test --test-concurrency=1 --test-reporter=tap checkpoints/wave4i/qa/independent-probe.test.mjs > "$TMPDIR/wave4i-qa/probe-$(date +%Y%m%d-%H%M%S).tap" 2>&1
```

Capture the command exit immediately; require all 4 children + parent completed, zero failures/cancellations/skips and clean process completion. Preserve any failed attempt rather than overwrite it. No application startup daemon is used. The token environment variable is an operator acknowledgement, not a resource lock.

Light verification: `node --check checkpoints/wave4i/qa/independent-probe.test.mjs`. This parses syntax without evaluating imports or running tests.

## Hypotheses and inspected evidence

Paths below are repository-relative; line ranges refer to inspected current source.

| Planned assertion / hypothesis | Verified source locations and gap |
|---|---|
| Fresh conversion and exact replay reject revocation after transactional session fencing, leave inquiry/quote/receipt/audit/outbox/order domain state unchanged | `apps/portfolio-api/src/app.mjs:141-147` session then membership write fences; `src/inquiries.mjs:45-50` guard before receipt replay. Existing `test/wave4i-inquiries.test.mjs:46-53` only revokes create replay after middleware authorization. New probe hooks the real sessions collection's transactional update, revokes membership before the membership fence, asserts hook reached once, restores in finally. This is a real DB/HTTP integration injection, not a mocked successful conversion. It does NOT test revocation after a membership write has acquired its lock, process kill, or every tenant/user/plant revocation kind. |
| Cross-inquiry same-key simultaneous converts produce one winner and one conflict, loser remains IN_REVIEW with no quote/history/audit/outbox orphan, receipt points to winner; new key can convert loser | `src/inquiries.mjs:4-5` unique scoped receipt/source quote indexes; `:42` payload hash includes inquiry ID; `:49-50` receipt conflict; `:71-80` quote/stage/receipt/audit/outbox writes in transaction. Existing `test/wave4i-inquiries.test.mjs:69-70,103-110` races only the same inquiry. New probe also races 4 same-key and 4 changed-key calls per inquiry, checks one receipt and full successful-response equality. Scheduling is concurrent HTTP, not a forced internal two-writer barrier. |
| Source fields remain frozen; caller source override fails without effects; prices alone can change while quantity `1.250000`, UOM `EA`, currency `USD` remain exact strings | `src/inquiries.mjs:13-19,38,67-74`; `src/commercial.mjs:90,120-123`. Existing `test/wave4i-inquiries.test.mjs:114-118` tests quantity tamper only. New probe covers description/UOM/missing provenance/foreign inquiry/item/drawing tamper and override payloads, preserves old revision and full lineage through approval/SO/shipment/invoice. Single-line probe does NOT independently prove reorder/deletion/duplicate-line tamper; owner multiline suite remains separate. |
| Sourced VAT invoice issues through safe renderer projection without stripping API lineage; exact partial amount `3.00 + 0.33 = 3.33 USD`; issued historical quote/invoice bytes and SHA256 unchanged after revision and settlement | `src/fulfillment.mjs:185,215` server-derived provenance; `src/documents.mjs:33-55,90-103` source snapshot/PREPARED/renderer path. Existing `test/wave4i-inquiries.test.mjs:63-77` sourced VAT quote only; `:138-145` sourced NO_TAX invoice. Existing `test/wave4h-vat-documents.test.mjs:90-101,128-130` direct VAT PDFs/historical bytes. New probe adds sourced VAT quote v1/v2 and partial invoice real PDF fetches, SHA256/byte equality after payment, API lineage unchanged, direct NO_TAX quote compatibility. No renderer/golden/schema edits. This compares within-run historical hashes, NOT hardcoded cross-run golden bytes or all pre-existing document records. |

All abbreviated `src/` and `test/` paths in the table are under `apps/portfolio-api/`.

## Ownership and remaining proof

Uses `apps/portfolio-api/test/support/owned-mongo.mjs:10-18`: new private single-node memory replica, random `portfolio_test_` DB, `ownedRun` marker before initialization and marker check before drop; no externally configurable DB URI. Probe additionally checks database prefix and marker before snapshots. Teardown remains helper-owned. No shared PostgreSQL interaction. Helper startup-failure cleanup and post-start teardown are not independently exercised here.

Pending lead token: runtime imports, marker/bootstrap and cleanup, auth injection execution, API assertions, race outcomes, real VAT invoice renderer compatibility, PDF byte/hash replay, TAP counts. Existing owner's 161/161 report is not independent proof and was not rerun. No product/test-owner files changed, no goldens updated, no Git operations. Full E01 remains PARTIAL; user-approved one inquiry → one quote and within-quote commercial revisions preserved.
