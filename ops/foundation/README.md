# Foundation tools

All database commands require a loopback replica set and `portfolio_owned_*` database. They never connect to PostgreSQL or promote imported records. Install the existing API pinned dependencies with `npm --prefix apps/portfolio-api ci --ignore-scripts --workspaces=false`; no new root dependencies or compose mounts are needed.

## PLAT-042 migration v1

Run `node ops/foundation/migrate.mjs plan snapshot.json` offline. A snapshot contains `version: 1`, UUID `runId` and `tenantId`, and at most 500 records/4 MiB per run. Each record supplies `domain`, `sourceId`, JSON `data`, optional `references: [{domain, sourceId}]` and optional `ledger: [{unit, amount}]`. Ledger amounts are signed exact strings, bounded to 30 integer and 12 fractional digits. UOM/currency remains explicit in source data. Every referenced source record must be present in the same bounded snapshot. Source data comes from an independently authorized export, never a live PostgreSQL connection here.

Inspect the generated counts/hash/ledger totals against the approved source export. Add the returned `expected` object to the original snapshot; do not replace the snapshot with the planning output. Set `FOUNDATION_RUN_ID` to its run ID plus `PORTFOLIO_MONGO_URI` and `PORTFOLIO_DB`, then run `stage snapshot.json`, `verify snapshot.json` or `rollback snapshot.json` through the same CLI.

Staging is one atomic transaction with run metadata and audit. IDs are deterministic UUIDv8 derived from tenant/domain/source identity; SHA-256 hashes use canonical sorted JSON. Ordering and run changes preserve stable IDs. Every write is limited to `foundationMigrationRows`, `foundationMigrationRuns` and audit. Staged rows never overwrite domain collections. Replays compare manifests and verify rows. Verification checks counts, hashes, relationships and exact totals. Rollback verifies hashes before deleting only its tenant/run rows and retains the run/audit history. Replay of a completed rollback returns its durable status.

This is bounded staging tooling. Large exports require a separately agreed partition/relationship protocol, not silent truncation. Publication/cutover, production import, source deletion, authoritative ledger promotion, and user data-owner signoff have not occurred. Unknown commit requires reconciliation using the same run ID. Service owners must retain the existing domain authority until separately authorized handoff.

## Evidence timing

Minimum syntax/type and focused owned synthetic smoke checks run during implementation. Independent browser, security, real dataset parity, contention/stress and HA acceptance remain final QA. Never call single-member replica results production acceptance.

## PLAT-002 native artifact failure and recovery

`apps/fastapi-msproject/tts_announcement.py` now gives every Piper invocation a fresh sibling staging directory. Only a new PCM WAV with positive frame count/sample rate and complete declared frame data replaces the requested body path. A stale pre-existing WAV, nonempty corrupt output, truncated frames, timeout or nonzero exit cannot become the new result. Each invocation performs one bounded Piper call with explicit UTF-8 I/O; recovery is a separate caller-controlled attempt. Failed attempts retain any previously completed target and remove their own staging files.

MP3 merge similarly exports to a sibling staging path, closes the returned encoder file handle, verifies nonempty output and positive duration, then atomically replaces the target on the same filesystem. Failed export cannot truncate a completed target. Public function names/signatures, response keys, speech text, gap defaults and existing public error messages remain. The helper does not own database publication, queue claiming, approval, retries or playback.

Run focused checks from the repository root with `python -B -m unittest discover -s ops/foundation -p test_tts_announcement.py -v`. Test files live beneath `PAPERCLIP_RUN_SCRATCH_DIR` when injected, otherwise the test runner's standard temporary directory. The suite uses synthetic PCM, injected Piper/encoder outcomes, and one actual bounded Python child process for timeout/recovery; that child is a CLI stand-in, not Piper. Encoder success tests do not claim real MP3 decoding. No FastAPI `main.py` import, PostgreSQL connection, model download, public artifact or background service is used.

Sequential handoff: TPR-145 owns worker/player integration after this foundation commit. The current `apps/tts-worker/generate_pending_audio.py` has its own generator and does not import this helper; these fixes must be deliberately incorporated into that active worker path before claiming end-to-end native recovery. Keep job-attempt ownership and database publication fencing there, and preserve the prior completed artifact when publication is denied. Browser durability, real Piper/model generation, actual MP3/ffmpeg playback, DB publication concurrency and worker crash recovery are final integration/QA evidence, not results of this synthetic suite. Existing pydub 0.25.1 remains the runtime dependency; no package/lock/worker/UI files changed here.

## PLAT-004 local profile

Set `FOUNDATION_PROFILE=owned-synthetic`, then run `node ops/foundation/profile.mjs`. It starts exactly one owned ephemeral replica, prints measured startup and memory, closes its connection and stops only its own replica. `MONGOMS_SYSTEM_BINARY` can select an already installed MongoDB 7.0.14 executable; otherwise the pinned harness uses its managed cache/download. No persistent application DB is created or dropped. MongoDB resident MiB and Node runner RSS bytes are separate measures. The output is idle startup evidence, never a workload capacity claim.

Compatibility profile: API Node >=24, tenant-foundation Node >=24 <25, MongoDB driver 6.20.0, local MongoDB 7.0.14 replica set, wiredTiger and majority writes. Run the combined profile on Node 24. Standalone MongoDB is rejected by the connection guard. Legacy PostgreSQL versions/data are unchanged and unqueried. Cloud/Atlas, multi-member failover and other Node/MongoDB versions require their own evidence.

## PLAT-037 query lab

With an owned running application database, run `node ops/foundation/explain.mjs scope.json`, where the file contains synthetic UUID `tenantId`, `plantId` and `userId`. The tool runs bounded read-only `executionStats` explains for memberships, sessions, audit pagination, command replay and pending outbox. It emits the actual winning plan, keys/documents examined, returned rows and elapsed milliseconds. It never manufactures a PASS when the dataset is empty or the planner selects a collection scan. Session and audit compound indexes support the scoped query shapes; existing membership/replay/outbox indexes remain. Domain owners must measure their aggregate queries on representative data and perform contention campaigns during final QA. Do not extrapolate a five-query synthetic lab to all domain collections.
