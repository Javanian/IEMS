# Wave4j bounded local acceptance

Verified on 2026-10-24 in `D:/Project AI/GITHUB/IEMS-worktrees/manufacturing-lot-serial`, branch `feat/manufacturing-lot-serial`, baseline `8324b0294677f2f9273f144eddc51b4b026a07ab`. Node 24.19.0, MongoDB 7.0.14 disposable owned replicas, real installed Chrome. Three parallel owners handled API, UI and independent review/corrections; lead integrated and executed final gates.

Accepted scope: immutable receipt lot/heat metadata; preserved reservation/consumption context; opt-in serialized work orders with ten distinct units across WO6/4; exact QC classification; selected accepted-unit dispatch with transactional duplicate prevention; and two local PR4 corrections. Work-order material context does not establish installed-component genealogy.

## Executed evidence

| Gate | Result |
| --- | --- |
| Owner new HTTP contract suite | 9/9 passed, exit 0 |
| Lead maintained API, 31 files | 186/186 passed, no failed/cancelled/skipped tests, exit 0 |
| Lead final frontend suite | 57/57 passed, no failed/cancelled/skipped tests, exit 0 |
| Independently authored shipment race/revocation probe, lead executed | 5/5 passed, no failed/cancelled/skipped tests, exit 0 |
| API syntax checks | Passed |
| Web production build | Passed |
| Final engineering focus reproduction on final harness | 52 checks, zero exceptions/console errors, exit 0 |
| Lead complete connected browser, all nine optional flags and customer service enabled | 94 checks, zero exceptions/console errors, exit 0 |
| Publication source/import audit and whitespace | Final SOURCE-MANIFEST.json checked by the existing audit-publication.py; zero errors |

Final browser switches: PAGINATION, REPAIR, DOCUMENTS, WMS, ENGINEERING, LABOR, VAT, INQUIRY and LOT_SERIAL all enabled. The new journey uses native traced receipt, QC/putaway, 6/4 planning, work-order release/record/QC, actual serial shipment selection, hard reload and independent Mongo assertions. A real successful shipment response is withheld after commit: the UI freezes the captured serials and identical retry leaves unit assignments, shipment, movements, keys, audit and outbox unchanged. Both partial shipments reconcile.

The restricted-role journey changes the real membership to quoteEditor, confirms CRM browsing remains denied, types a known account, submits by keyboard and verifies the persisted inquiry plus reload. Membership is restored in finally. API regressions separately prove reordered provenance keys remain valid while extra/missing/changed source values are rejected without writes.

The independent probe submits distinct concurrent keys for the same accepted serial. Exactly one shipment wins; one source tally and one SO tally each increase once; the loser leaves no receipt and may subsequently use its key for a different accepted unit. Foreign work-order/tenant sources fail without effects. A stored replay is denied when membership is revoked between middleware authorization and the committing guard. The probe was authored independently and executed by the lead; this is not an independently executed second full suite or an imposed internal writer barrier.

## Commands and retained evidence

From the worktree root, using the cached MONGOMS_SYSTEM_BINARY and external TMPDIR:

```powershell
npm --prefix apps/portfolio-api run check
npm --prefix apps/portfolio-api test
npm --prefix apps/web run test:portfolio
npm --prefix apps/web run build
node --test --test-concurrency=1 --test-reporter=tap checkpoints/wave4j/qa/serial-shipment-race.test.mjs
# Set all nine switches above to 1, unset NODE_TEST_CONTEXT and PORTFOLIO_SKIP_CS.
npm --prefix apps/web run test:portfolio:browser
python checkpoints/wave4h/audit-publication.py checkpoints/wave4j/SOURCE-MANIFEST.json
git diff --check
```

External evidence root: `D:/Project AI/GITHUB/IEMS-evidence/wave4j-20261024/`. Main records are `lead-maintained-api.tap`, `lead-independent-serial-race.tap`, `lead-web-unit-final.log`, `lead-web-build.log`, `lead-browser-final.log` and `browser-final/browser-results.json`. `verification-manifest.json` records hashes of source and retained logs. Browser screenshots `wave4j-serial-units-1440.png` and `wave4j-serial-units-375.png` were visually inspected: captured top-of-detail views reflow without clipping. Serial identities/status and the entire document's overflow/44px controls were also checked in the real DOM at four widths; this is not a full-page or universal accessibility certification.

## Failure disposition and limits

- Owner attempt 1 failed because fault injection addressed fulfillmentOutbox before the fixture had created the collection. Only fixture setup changed; original business assertions remained. Attempt 2 passed; both TAP logs remain.
- Browser attempt 1 reached traced receipt and ten accepted units, then stopped on a new test expression quoting error. Shared dependency junctions also caused Vite font 403 responses. Embedded expression quoting was corrected; the owned harness now allows the exact resolved dependency folder as well as its own repository. Production Vite configuration was not changed, and the zero-console-error assertion remains.
- Browser attempt 2 stopped on the existing engineering reduced-viewport focused-input visibility assertion. Focused diagnostics did not reproduce persistent clipping. The harness now waits for fonts and two animation frames after the viewport is applied before one focus/scroll action. Full visibility, Tab/Enter, focus outline, 200-percent text and reload assertions remain unchanged. Two focused runs and the final full run passed; the precise event ordering of the earlier failure remains unproven. No product CSS changed.
- The rendered-component test's embedded import paths were made relative to its real test directory so the publication import audit can resolve them. The same assertions passed again.
- Mongo teardown ECONNRESET diagnostics remain in successful API/browser logs. Successful assertions and exit codes do not establish flake-free behavior. The unchanged maintained runner preserves but excludes the historical Wave4g obsolete VAT-PDF rejection test.
- Build warnings for stale Browserslist data and chunks above 500 kB remain. Package files and dependency locks were not changed. Installed dependencies were reused through worktree junctions; this is not a clean-install proof.

Owned Mongo, Chrome profiles and test API/web processes were cleaned up; a post-run process query found no owned leftovers. Existing unrelated local applications were not stopped. The original dirty main checkout and CRM worktree's two raw TAP files remain preserved.

The acceptance run preceded the user-requested local checkpoint commit. That commit records this verified implementation and DEVELOPMENT-PLAN.md/BACKLOG.csv; planning changes do not add new runtime behavior. No push, new PR, merge, deployment or remote CI execution is included. PR4 remains open at its earlier remote head; its two fixes are local in this branch. Full E01 remains PARTIAL: Wave4k component genealogy, Wave4l controlled delivery/POD and Wave4m independent full fixture acceptance remain. No statutory-tax, repair VAT, SAP, live WhatsApp, cloud, broker, cutover or production acceptance is implied.
