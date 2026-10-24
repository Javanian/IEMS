# Wave4i independent QA execution handback

Heavy token RELEASED; all heavy execution finished sequentially. No active QA writers, API/Vite server or owned mongod/portfolio-profile Chrome remains. Full E01 remains PARTIAL; no merge acceptance implied.

## Actual outcomes
- Independent explicit probe attempt 02: exit 0, TAP tests 5/pass 5/fail 0/cancelled 0/skipped 0 (4 children + parent), 7499.4758ms. Fresh marked disposable owned Mongo; no supplied/shared URI or PostgreSQL.
- Verified fresh conversion and stored replay reject real membership revocation injected after the transactional session fence, hook reached once each; domain snapshots unchanged. Restored membership in finally.
- Cross-inquiry same-key concurrent HTTP conversion: one 200/one409, one winner receipt, loser unchanged/no orphan quote/history/audit/outbox; exact winner replay and loser new-key conversion work. Four-request same-key and changed-key same-inquiry races conserve one quote/receipt and exact successful response.
- Source override refusal and seven frozen revision tamper variants leave domain snapshots unchanged; original revision/provenance retained. Exact quantity/UOM/currency and sourced VAT partial invoice `3.00 + 0.33 = 3.33 USD` verified through real shipment/payment settlement.
- Real sourced VAT quote v1/v2 and invoice PDFs issue; renderer projection omits provenance without removing API lineage. Historical PDF bytes and hashes remain identical after revision/settlement. Direct legacy NO_TAX quote remains issuable.
- Unmodified full-flag real Chrome browser entry run independently after probes: exit 0, 88 PASS checks, exceptions 0, consoleErrors 0. All PAGINATION/REPAIR/DOCUMENTS/WMS/ENGINEERING/LABOR/VAT/INQUIRY=1; no CS skip. Includes actual CS checks, sourced VAT PDF parser/hash, multiline inquiry, manufacturing/partial fulfillment/settlement and native recovery paths. This is one independent browser run, not a flake-free guarantee or rerun of B's 50-unit suite.

## Retained RED / sole harness correction
Attempt 01: exit 1, tests5/pass3/fail2/cancelled0/skipped0. Three auth/race children passed. VAT child stopped at expected422/actual400 before intended tamper validation: harness spread persisted VAT line fields (`netAmount`/tax/gross metadata) into revision request, violating commercial input allowlist. Corrected only QA line134 to project description/quantity/uom/currency/provenance + changed unitPrice. All original 422 assertions, snapshots and historical-byte assertions retained; no product or owner test/browser edits. Attempt02 passed. Attempt01 Windows Mongo teardown ECONNRESET retained; final probe has no such noise. No product defect reproduced in these bounded probes.

## Evidence (external Hermes scratch)
Directory: `C:/Users/Admin/AppData/Local/hermes/cache/scratch/wave4i-qa/`
- `probe-01.tap` SHA256 b7ec05ec0aff93ba5e1f8b0cf3188507edb21a9c87e76994f8514359ca800a27
- `probe-02.tap` SHA256 a3a1fc839165e5c0c623a3f02b6be96dbf71b732dcee9183ebcabe8f4966d4e5
- `browser-01.log` SHA256 3d3531882f6d6e7c539b0c96e6de1d6dfd29d73ff0d923c9335efb7b40230313
- `manifest.json` captures source/log hashes. Browser artifacts: `C:/Users/Admin/AppData/Local/hermes/cache/scratch/portfolio-evidence-2c692115-e98e-428f-876e-dcb85531973f`.
- Historical quote v1 SHA256 bb9e67928e8ceefe0b0ed5645b795c2d5b74854d14cabdfbba10a5fb9600dab6; v2 6130ed7983313cd6da719376b582397c7ecb46bd1195ab9974e3f43ff6acd933; invoice v1 ce21cdd7ffc2fe17b7172c30a2f67cab15cf4520b87ceecd351e6c92f15ddc9e. Within-run equality, not cross-run golden hashes.

## Commands and fingerprints
From repo, `env -u NODE_TEST_CONTEXT TMPDIR='C:/Users/Admin/AppData/Local/hermes/cache/scratch' MONGOMS_SYSTEM_BINARY='C:/Users/Admin/.cache/mongodb-binaries/mongod-x64-win32-7.0.14.exe' WAVE4I_QA_HEAVY_TOKEN=lead-granted node --test --test-concurrency=1 --test-reporter=tap checkpoints/wave4i/qa/independent-probe.test.mjs`, unique attempt logs above, immediate exit captured.
Browser from apps/web: same TMPDIR/system binary; unset NODE_TEST_CONTEXT/PORTFOLIO_EVIDENCE_DIR/PORTFOLIO_SKIP_CS; all eight flags above=1; `node test/portfolio-browser.mjs`, immediate exit captured.

QA probe SHA256 6bce1db2c46b5ea51d94ddb55439435887f403e9f7eab18aa986ce60c6dce5a3.
Provider hashes match A: inquiries 1df3707373313cd850dc62e88050f955cbc0b7423ee727fbff81c286d8f8c40f; commercial 7c0d1e369d67fc0ca3c1a9699996ede6f6e7155e7688dacccfe4daa775e00d14; fulfillment e3dd35ca37f0fcc1a3ec9e54ff4f8e5e93c43ec1a932c597944cd28e4cf0321c; owner inquiries test 5eee442eafda27fd7b19b62d1046a51f758db1e9cf0f6697f403181cb4e1391c.
Unmodified browser entry 73d42fdda9f86fba89b0ceb27ef6e4cdac64d3abdc44762268d286b5ff999f24; inquiry browser 9963a6f402397207444d4bd031b780735409747b31dcd6b78bbc0d76a77db5d7.

## Cleanup / limits
Owned helper asserts run marker before dropping DB, closes server/client/replica; successful parent includes teardown. Browser finally closes owned resources. Post-run Win32_Process query for any mongod.exe and portfolio-chrome Chrome returned no rows (exit0). No daemons, containers, private WA, shared PG, root lock or Git operations used. Repo modifications this execution: QA harness allowlist correction and this report only. External evidence manifest/logs retained. Learned harness pitfall recorded in owned-child-test skill.

No claim of deterministic internal two-writer barrier, revocation after membership lock acquisition, OS-kill rollback, every revocation kind, multiline reorder/delete/duplicate tamper independent API coverage, cross-tenant inquiry browser or universal accessibility certification. Existing owner evidence remains distinct from these independently executed outcomes.
