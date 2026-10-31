# TPR-145 commit ledger and feature matrix

Implementation candidate: `4deef871c73a7e98f21b05e9fa3e95567db2178d`. The final handoff tip may add documentation only; use the exact issue work product/checkpoint tip for integration. Local commits only, no push/public merge/deployment. Independent acceptance NOT_RUN.

Workspace: `D:/Project AI/GITHUB/IEMS-worktrees/iems-all-20261030-operations`, branch `program/iems-all-20261030-operations`. Accountable agent: `ff1ace63-5999-42fc-87c9-697fed1540f0`.

Accepted base `0ad4248af46adad2762763438efb27aaace932b4` was fast-forwarded cleanly to fulfillment prerequisite `7f7ed96996e0d6a6955a5d0db2b93116f5b3d090`. This preserves UI `04d0b28278b153939c3afefd36bf0ef4992223ca`, sequential native TTS foundation fix `6dcf606` and the fulfillment/manufacturing/data provenance documented in TPR-143. No duplicate cherry-pick or conflict resolution was performed. Both first-class prerequisites were done before feature edits. The initial transient TPR-143 status discrepancy resolved; the attempted blocked transition was rejected before effect.

| Roadmap | Status | Implementation / boundary |
| --- | --- | --- |
| PLAT-018 | IMPLEMENTED_QA_PENDING | Actual scoped source metrics and drilldowns, production stage aging, EWS, exact UOM quantity groups, one invoice balance per order, reconciliation watermarks/freshness, maintenance capacity heatmap, concrete read-only legacy adapters and registered sample snapshots/relay. Legacy connection/schema acceptance and real source feeds remain external/runtime configuration boundaries. |
| PLAT-030 | IMPLEMENTED_QA_PENDING | Subject consent, trusted 1:1 signed assertion contract, nonce/device/profile-bound one-time challenge, NFC/PIN fallback, replay/cooldown/revocation/entity fences, private audit/receipts. No biometric enrollment. Actual capture/verifier, consented pilot identities and physical reader acceptance remain external. |
| PLAT-032 | IMPLEMENTED_QA_PENDING | Source-derived zone queue, pinned Piper helper/worker, artifact validation, explicit local publication, exclusive playback leases, separate native generation/player-start timing, cancellation and owned recovery. Successful real-model generation and speaker/browser audio acceptance remain NOT_RUN/external. |

| Roadmap | Local SHA | Change |
| --- | --- | --- |
| PLAT-018 | `038adebc651fb3f714e52548b5ece104890bc9e3` | Scoped metrics, stage aging, capacity, source adapters and UI |
| PLAT-030 | `39793e8a9d3dae5ebd2776dce9fde9ffefe721cc` | Consent/challenge/fallback backend, UI and smoke |
| PLAT-018 | `a51be00ccde250b6571d0916ebbdc70c80b84269` | Source-bound telemetry and separate verified invoice balances |
| PLAT-030 | `142ce2d2e7405c92ce32d89a301af4cedfd1159a` | Subject entity fences, unique NFC credentials, NFC removal/replay smoke |
| PLAT-018 | `6d5766805b61b41c64e45d5e03d02527401dde37` | Concrete PostgreSQL read-only adapters, signed SPC and sample freshness |
| PLAT-018 | `af2811e1f2e5cdedcf6a15081714e299659940b2` | Reconciliation baseline/watermarks and fresh drilldown authorization |
| PLAT-018 | `6f564102f4db9b894bcaeea84fd31d262cecc79d` | Actual record links, robust stage timestamps and closed-stage EWS exclusion |
| PLAT-032 | `4deef871c73a7e98f21b05e9fa3e95567db2178d` | Zone lifecycle, pinned native helper/worker, player receipts/recovery; actor-scoped operations receipts prevent cross-actor token replay |

## Actual minimum verification

All commands ran in the assigned worktree. Tests before a feature commit used that exact staged source plus the explicitly owned dirty changes; final browser inspection ran at the implementation candidate above. Final web build used the same player/source content; later operations-only drilldown presentation was compiled/rendered by Vite inspection. Documentation additions do not alter runtime source.

| Check | Actual result | Evidence |
| --- | --- | --- |
| `node --check` changed API modules and web operations client | PASS, exit 0 | Run transcript; no runtime/model assertion |
| JSX ESLint on all four owned screens/player | PASS, exit 0 | Run transcript |
| `npm --prefix apps/web run build` | PASS, exit 0 | `final-web-build.log`; retained existing Browserslist/large-chunk warnings |
| `node --test ops/operations/metrics.test.mjs` | PASS 5/5, exit 0 | `PLAT-018-metrics-final.log`; exact money/UOM, absence/freshness/privacy, five adapter read-only SQL binding fixtures |
| `node --test --test-concurrency=1 ops/operations/workforce.test.mjs` | PASS 1/1, exit 0 | `PLAT-030-api-final.log`; owned Mongo + loopback HTTP, PIN/NFC/replay/consent withdrawal/error/revocation/removal/privacy |
| `node --test --test-concurrency=1 ops/operations/voice.test.mjs` | PASS 2/2, exit 0 | `PLAT-032-api-final.log`; absent/unpinned store refusal; owned Mongo lifecycle/leases/elapsed duration/recovery/actor isolation and source-bound telemetry correction/revocation. Audio store is explicitly synthetic. |
| Python source `compile(...,'exec')` for changed native helper/worker | PASS, exit 0 | Run transcript; no bytecode artifact committed |
| `python ops/operations/test_zone_worker.py` | PASS 3/3, exit 0 | `PLAT-032-python-final.log`; absent/mismatched model, failed generation cleanup, uncertain completion artifact preservation |
| Three `browser-smoke.mjs` screen invocations | PASS, exit 0 each | `Operations/Workforce/Voice-final-browser.log`, inspection JSON and 1440/375 screenshots; synthetic reads, no page errors/document overflow, keyboard button focus |
| `player-smoke.mjs` | PASS, exit 0 | `PLAT-032-player-final.log`, `player-inspection.json`; synthetic HTTP/media methods, same-key start retry, duplicate action/ended suppression, acknowledgment only after ended, unmount cleanup; real audio NOT_RUN |
| Diff/ownership/secret/runtime-artifact inspection | PASS | Only explicitly owned paths staged; no manifest/lockfile/shared-router changes, no guards removed or no-verify |

Evidence root: `D:/Project AI/GITHUB/IEMS-evidence/iems-all-features-20261030/operations`. Screenshots were visually inspected on phone and desktop. Mongo logs can contain ECONNRESET cleanup diagnostics despite passing assertions/exit 0; no reliability acceptance is inferred.

Corrected implementation/harness failures: blank injected Git author/committer identity required process-local identity values; the initial UI harness used the wrong Vite cwd/dependency URLs and exact required-label matcher; a player fixture used invalid audio bytes and was replaced by the existing header fixture while media methods remained mocked; one telemetry test accidentally spread a Mongo-added `_id` into a command and was corrected by copying the fixture before insertion. None required a production action, removed guard or recovery-task chain.

Full independent regression, security/concurrency/stress/recovery, real API+DB browser matrix, desktop/mobile/kiosk visual/accessibility, real model/speaker/device/legacy connection and cloud acceptance are NOT_RUN. They remain TPR-150/152 after TPR-149 integration. No persistent service was left running; owned Mongo/Vite/browser resources close in cleanup/finally blocks. Remote/CI and actual resolved model are UNKNOWN/UNVERIFIED; adapter configuration alone is not model evidence.

Next owner: CTO TPR-149 integrates this branch tip once, preserving prerequisite ancestry, applies the exact shared registration/adapter configuration in [README.md](README.md), records all SHAs in the program ledger and supplies the immutable integrated candidate to TPR-150, then TPR-152. No further implementation blocker remains within this owned handoff.
