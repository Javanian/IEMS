# Sales-order planning acceptance

The production planning panel reads every plant work-order cursor page before filtering the selected sales order. Partial reads stay loading; a failed page is an error and can be retried. The actual application router keys order-detail routes, aborting the previous resource and clearing command/result state on navigation.

Install the existing locked dependencies in `packages/tenant-foundation`, `packages/customer-service`, `packages/document-rendering`, `apps/portfolio-api`, `apps/wa-demo-bridge` and `apps/web` with `npm --prefix <path> ci --no-audit --no-fund`. Use Node24, MongoDB7.0.14 and Chrome on Windows, macOS or Linux. `PLANNING_BROWSER_BINARY` may select an installed browser. The runner requires2GiB available RAM at startup and1.5GiB at subsequent viewport gates; it does not stop other services or reduce guards. MongoDB is acquired by mongodb-memory-server; `MONGOMS_SYSTEM_BINARY` may select an existing matching executable.

From the repository root:

```sh
node --test apps/web/test/portfolio-order-planning-completeness.test.mjs
node apps/web/test/portfolio-order-planning-browser.mjs
node apps/web/test/portfolio-order-planning-e2e.mjs
npm --prefix apps/web run test:portfolio
npm --prefix apps/web run build
python checkpoints/review-five-findings/audit-publication.py
```

Set `PLANNING_EVIDENCE_DIR` (mock) and `PLANNING_E2E_EVIDENCE_DIR` (connected) to separate fresh output directories. Run these browser commands sequentially. They use their own loopback ports and temporary profiles. The connected runner starts a marker-owned disposable replica set, initializes the current schemas/foundation, seeds official synthetic identities and logs in through the real UI. It serves the actual application index, App and router through Vite. It neither bypasses authorization nor replaces production components.

OP-01 creates work orders through the real UI and checks exact normalized quantities, identity, allocation, audit/outbox/key effects with a separate Mongo client, then checks reload persistence. Valid source sales orders are prepared through real account/quote/approve/accept/convert HTTP operations. The supplemental222-row read fixture directly inserts deterministic PLANNED rows and reconciled allocation records in that disposable database, retaining source-line/account/version/UOM and scope invariants. That setup is not presented as an operator action. Actual cursor responses prove first100 unrelated rows and targets on pages2/3. The independent DB oracle supplies exact IDs and text values for OP-02/03.

OP-04 holds an already obtained real final-page response to prove loading before true empty. OP-05 injects a labeled503 after a real later-page200, then requires full retry recovery. OP-06 checks genuine AbortSignal cancellation and, separately, a labeled test adapter that ignores the signal while the actual delayed HTTP body is consumed; neither old response may contaminate the new order. OP-07 exercises real tenant/selected-plant fences and denied writes with no DB effects, including a forbidden browser deep link. OP-08 checks desktop/mobile/kiosk viewports, readable rows, control bounds, focus and a native keyboard submission; physical kiosk hardware is not tested.

The negative control changes only the served `PlannedForOrder` call back to the old first-page read, in the same isolated runtime after successful positive scenarios. Both exact-ID assertions OP-02/03 must fail with an assertion error and missing targets; setup failures are rejected. `negative-control.json` preserves those expected failures. The overall acceptance runner exits nonzero on unexpected failures, missing negative-control failures or cleanup errors. Source files and Git refs are not modified by the control.

CI invokes the existing nine-check production-component harness with **mocked HTTP** and the connected **actual API/disposable DB** runner as separate required steps in Portfolio VAT acceptance. Both must exit0. Their JSON and screenshots are retained in the `order-planning-<run>-<attempt>` artifact; artifact existence alone is not result verification. Inspect `results.json`, `fixture-oracle.json`, `negative-control.json`, final DB oracle, cancellation/stale evidence and relevant screenshots. Measurements cover the synthetic223-row alpha dataset after the UI write, with sequential requests and O(N) retained records. They are not large-plant benchmarks or a concurrent-write snapshot guarantee. This is isolated backend integration, not verification against a deployed live service. Historical transport attribution remains partially explained; these tests do not establish its root cause.
