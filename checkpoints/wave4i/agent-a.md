# Agent A handback

Heavy token RELEASED. No active writers/server or mongod remains (Win32_Process query returned empty). Owned random database marker checked before drop; clients and replica sets stopped in test teardown. No commits, root lock edits, shared PG, containers or renderer edits.

Implemented inquiry create/list/detail/revision/stage/conversion with scoped quote grants, committing auth fences, durable receipts, optimistic versions, transaction audit/outbox and unique source quote index. Frozen provenance flows through approval/SO and server-derived shipment/invoice metadata. Sourced revisions reject source edits; direct quotes unchanged. Existing document renderer already projects its permitted fields: real sourced quote and invoice issuance succeeds without injecting lineage into PDF snapshots, so no document code/schema changes required.

TDD: observed 404 missing create, then GREEN; observed 404 revision, then GREEN; observed INVALID_LINE sourced commercial revision, then GREEN; observed missing shipment provenance, then GREEN. Additional negatives/regression assertions exercise existing guards. First harness run required independently locked npm ci in API and document-rendering package (ignored node_modules, no copied dependencies). No unsupported business contract found.

Final owner verification: `npm test` explicit maintained runner includes new wave4i-inquiries.test.mjs, 28 files, tests 161/pass 161/fail 0/skipped 0, exit 0, 268571.4137ms. `npm run check`: Syntax checks passed. New file has 5 child tests + parent = 6 TAP tests. Coverage includes exact strings/IDs, old revision preservation, stages/history, same-key concurrent replay, different-key conversion race, actual audit/outbox collMod rollback on create and conversion, transaction-bound replay revocation, foreign tenant/scope, invalid/stale/manual QUOTED, sourced price revision/tamper, quote PDF, approval/acceptance/SO, actual partial reservation shipment and invoice/payment settlement lineage, VAT sourced quote PDF. Existing maintained suite covers direct NO_TAX/VAT/PDF history. Full E01 still PARTIAL; independent lead acceptance/browser work pending.

Suite stderr has Windows Mongo shutdown ECONNRESET noise (84 text occurrences); not clean stderr despite TAP success. Raw local logs apps/portfolio-api/test/wave4i-maintained.tap and wave4i-targeted.tap. HANDOFF contains exact consumer response shape. Potential follow-up QA depth: conversion-specific midflight revocation, same-key different-inquiry concurrency, and VAT sourced invoice PDF are not separately isolated by new tests (shared transaction mechanisms/direct VAT invoice suite covered).

Final SHA256:
- src/inquiries.mjs 1df3707373313cd850dc62e88050f955cbc0b7423ee727fbff81c286d8f8c40f
- src/commercial.mjs 7c0d1e369d67fc0ca3c1a9699996ede6f6e7155e7688dacccfe4daa775e00d14
- src/fulfillment.mjs e3dd35ca37f0fcc1a3ec9e54ff4f8e5e93c43ec1a932c597944cd28e4cf0321c
- test/wave4i-inquiries.test.mjs 5eee442eafda27fd7b19b62d1046a51f758db1e9cf0f6697f403181cb4e1391c
