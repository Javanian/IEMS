# Agent A — backend owner

Base: `f4cf6fd`. Worktree: `company-stock-use`. Source is frozen after owner attempt 4 pending final independent review. No commit, push, frontend build or full maintained-suite execution was performed by this lane.

## Implemented boundary

Explicit `INTERNAL_PLAN_V2` creates a typed `INTERNAL_EXECUTION_V2`. Purchased material retains the catalog receipt path; manufactured material uses real accepted company-unit identities from a validated stored V1 producer with purchased inputs. Existing V1 request shapes remain supported.

Separate company use heads, unit projections, reservation revisions, issues, consumptions and events preserve immutable producer company receipts, company units and output rows. Issue retains physical on-hand; the first operation consumes once. Mixed per-output and process-loss attribution reconciles every material line and actual company identity. Direct consumed raw receipts, embodied consumed ancestry and abandoned audit history are distinct. Accepted descendants enter unvalued `LEAF_ONLY` company storage with zero reuse or customer dispatch entitlement.

Inherited holds conservatively cover the producer batch's actual `consumedReceiptIds` union, excluding abandoned audit receipts. `consumedAncestryReceiptIds` is not the chosen output's exact raw allocation subset. Selected company units retain their actual producer output IDs and immutable attribution hash, so their detailed production evidence remains traversable; this increment does not implement a general fine-grained descendant hold/freeze graph.

Whole-company-receipt hold/release actions retain physical counts. Holds block fresh use and dependent progress; an unissued claim can be abandoned while held. Fresh use checks current producer demand, item, location/bin, direct hold and consumed raw ancestors, with actual dependency and source writes. Current authorization remains inside the transaction before replay. No F5 fence removal, authorization cache or throughput optimization is included.

Owned source files: `apps/portfolio-api/src/company-stock.mjs`, `company-stock-state.mjs`, `internal-execution.mjs`, `internal-execution-state.mjs`, and `internal-production.mjs`. Parent owns `app.mjs`, seed/registration and shared documentation. Owner tests use `apps/portfolio-api/test/company-stock-use.test.mjs` and their own `test/support/company-stock-owner-fixture.mjs`; their happy path uses mounted authenticated HTTP. Agent C authors a separate independent fixture/probe, also used by the native browser journey. Shared generic `startOwned` supplies only the disposable marked Mongo/runtime harness.

## Exact owner attempts

Command, from `apps/portfolio-api`:

```text
node --test --test-concurrency=1 --test-reporter=tap test/company-stock-use.test.mjs
```

Cached MongoDB 7.0.14, one owned replica, 0.25 GiB WiredTiger cache. Runtime preflight requires at least 2 GiB free RAM and zero pre-existing mongod processes. Evidence is external under `D:/Project AI/GITHUB/IEMS-evidence/company-stock-use-20261025/`.

| Attempt | Result | Evidence | Explanation |
| --- | --- | --- | --- |
| 1 | 0 passed, 1 failed; exit 1 | `owner-attempt1/owner-company-stock-use.tap`, `exit.json` | Initialization attempted the same auto-named head index with unique and nonunique options. Removed the redundant nonunique declaration; retained the unique source index. Raw teardown ECONNRESET remains in the log. |
| 2 | 9 passed, 0 failed, 0 skipped; exit 0; 26.11 s | `owner-attempt2/owner-company-stock-use.tap`, `exit.json` | Real V1 producer accepted2/rejected1; V2 target2/good1/scrap1 with company ratio1 and purchased LOT ratio1.25; full reservation through terminal putaway, rollback, holds, replay, lineage and immutable opening checks. |
| 3 | 9 passed, 0 failed, 0 skipped; exit 0; 27.85 s | `owner-attempt3/owner-company-stock-use.tap`, `preflight.json`, `exit.json` | Added same-job abandon/re-reserve of the same actual unit; dedicated permission replay denial with missing or relabeled current execution head. |
| 4 | 12 passed, 0 failed, 0 skipped; exit 0; 28.68 s | `owner-attempt4/owner-company-stock-use.tap`, `preflight.json`, `exit.json` | Final source-snapshot/history hardening; untyped ISSUE replay with missing/relabeled head; coherent self-hash-linked producer-pointer/QC/location/history-kind corruption refusal; legacy attribution discriminator exclusion. |

Attempt 3 follows two concrete fixes. Replay classifies both current authority and the stored prior result before checking the extra company action; deleting or relabeling the current head cannot remove that check. The exported company reservation writer also requires a transaction, immutable binding, valid transition and actual unit/count/serial ownership, and rejects blocked non-abandonment writes. Exact historical replay under later source holds remains supported for authorized actors.

The owner fixture proves producer opening receipts/units/outputs stay byte-equal, producer raw consumption records stay unchanged, and its received stock counters and public versions do not decrement again. Source fence fields may advance. Restored fault injections are explicit test-only database changes, not happy-path authority construction.

## Pending acceptance and limits

Agent C owns independent HTTP, corruption and controlled two-session source-CAS proof. HTTP races alone do not distinguish stock contention from shared authorization serialization. The controlled exported-writer probe is intentionally abort-only and does not claim to be two committed authorized requests.

The parent still owns maintained API, frontend, build and native browser acceptance. No result for those gates is inferred from the twelve owner entries. General manufactured ancestry reuse, graph traversal/cycles, customer stock dispatch, valuation, installation, replacement and rework remain outside this increment. F5 stays blocked at its accepted boundary.

The final source snapshot is checked against actual immutable company receipt/QC/location, producer provenance and ordered unit/output/serial/hash pointers. Every historical reservation snapshot retains the company source kind. The owner corruption test deliberately updates ledger hashes, the full reservation previous-hash chain, historical/current projection references and execution event hashes before asserting refusal against the unchanged actual producer anchor. Thus refusal is not merely an accidental stale hash check. Every injected document is restored exactly.

The ISSUE replay regression uses the actual committed body without a source discriminator; missing or relabeled current heads still require the company issue grant through stored prior-result cohort classification. This specifically tests the historical-key classification path, rather than relying on the reserve body's source-kind fallback. No production edit will occur during the final independent run.
