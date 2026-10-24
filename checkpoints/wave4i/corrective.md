# Wave4i P2 corrective handback

## Change

Corrected only the pre-validation provenance scan at `apps/portfolio-api/src/commercial.mjs:90`: require `Array.isArray(req.body.lines)` before calling `.some`. Malformed non-arrays now reach the existing `validate()` / `INVALID_LINES` 400 contract. Array provenance still takes the existing `SOURCE_TAMPER` 422 path; sourced revision enforcement and tax arithmetic were not changed.

Added maintained HTTP regression `apps/portfolio-api/test/wave4i-direct-quote-validation.test.mjs`. It submits object, string, number, null, omitted lines and empty array through the actual authenticated app on an owned replica. Each asserts exact 400 / INVALID_LINES and unchanged quote, commercial audit and commercial outbox counts. No expectations were weakened between RED and GREEN.

## Executed verification

Node v24.19.0; commands below run from `apps/portfolio-api`, sequentially, without an externally supplied Mongo URI. Inspected all maintained test entrypoints: Mongo-backed suites use their own `MongoMemoryReplSet`, randomized `portfolio_test_` database and marker-verified teardown, either directly or through `support/owned-mongo.mjs`.

| Gate | Command | Child exit | TAP results |
| --- | --- | --- | --- |
| RED before source correction | `node --test --test-concurrency=1 --test-reporter=tap test/wave4i-direct-quote-validation.test.mjs` | 1 | 7 tests; 3 pass, 4 fail (three malformed subtests plus parent); 0 cancelled/skipped |
| GREEN unchanged regression | same command | 0 | 7/7 pass; 0 failed/cancelled/skipped |
| Maintained API | `node scripts/test-maintained.mjs` | 0 | 29 files, 168/168 pass; 0 failed/cancelled/skipped |

RED proved `{}`, `"bad"`, `42` each returned HTTP 500 / INTERNAL_ERROR instead of the asserted 400; null, omitted lines and empty array already passed. GREEN proves all six cases return the exact required contract with no commercial writes. Maintained suite includes existing commercial NO_TAX, VAT rounding/document and Wave4i inquiry lineage/tamper coverage. Historical `wave4g-tax.test.mjs` remains excluded by the unchanged maintained runner because its PDF rejection expectation is obsolete.

Raw logs contain `MongoNetworkError: read ECONNRESET` diagnostics despite clean successful GREEN/full-suite exits and zero failed/cancelled tests. These were not suppressed or represented as pristine output; no out-of-scope teardown changes were made.

## Evidence and SHA-256

External evidence directory: `C:/Users/Admin/AppData/Local/hermes/cache/scratch/wave4i-corrective-20261024/`.

- `red.tap`: `e8973e421cef0d6e190fceaf0ac3bbf92f435169125201ab66246f11690da136`
- `green.tap`: `5915866ff610b88d0549d791d4414164220e117e8a16b172051cc9d538e6ec1b`
- `maintained.tap`: `44531843ce11b47be391a87c6a7f633fb9e38d6bba1d6827ef14748127c11806`
- Corrected `apps/portfolio-api/src/commercial.mjs`: `5da024a60195c9ef47c2a5979c38c7e16a4eff9cf4383cde22941516003d183c`
- Added `apps/portfolio-api/test/wave4i-direct-quote-validation.test.mjs`: `f3277df61b14ee2cf8cb4e53af4f7d71882877b0f25d7d2242d92b5d6f9f162e`
- Unmodified `apps/portfolio-api/test/wave4i-inquiries.test.mjs`: `5eee442eafda27fd7b19b62d1046a51f758db1e9cf0f6697f403181cb4e1391c`

`results.json` preserves GREEN/full-suite commands, child exits, counts and log hashes. The outer RED capture command exited 0 to print evidence; the recorded test child exit is correctly 1. Subsequent sequential verification wrapper exited 0 only after both children exited 0.

## Cleanup and boundary

All test children completed; marker-verified database drops, client closes and replica stops were registered by the existing fixtures and completed without test hook failures. No persistent app server or daemon was started. Initial RED evidence landed under Windows Temp because the terminal TMPDIR differed from the advertised scratch location; it was moved to the external Hermes scratch directory above. GREEN/full-suite temporary paths explicitly used that scratch directory.

Only the source guard, dedicated regression and this checkpoint were written in the requested worktree. No UI, renderer, golden, root lockfile, Git operation, shared PostgreSQL, private WhatsApp, publication or original dirty checkout changes. Parent owns independent rerun, review, commit and publication; this is a corrective API gate, not full E01 acceptance.
