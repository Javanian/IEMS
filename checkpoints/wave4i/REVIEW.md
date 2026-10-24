# Wave4i independent precommit review

Verdict: **one P2 blocker** in the reviewed source. No product files changed.

## Required correction

- **P2 — malformed direct-quote lines now produce HTTP 500 instead of a validation error.** `apps/portfolio-api/src/commercial.mjs:90` calls `req.body.lines?.some(...)` before `validate()` checks `Array.isArray(body.lines)` at line 21. Optional chaining only protects null/undefined; `{}`, a string, or a number reaches a non-callable `.some` and throws `TypeError`. The unchanged app error handler (`apps/portfolio-api/src/app.mjs:121-123`) maps this to 500/INTERNAL_ERROR, bypassing the prior INVALID_LINES 400 contract. This is a direct-legacy API compatibility regression introduced by the provenance rejection. Guard the provenance scan with an array check or perform structural validation first while retaining SOURCE_TAMPER rejection. Add malformed non-array cases to the direct-quote regression tests.
  - Executed a lightweight, dependency-free route-handler probe against the actual imported `installCommercial`, registering handlers on a stub app and invoking POST `/api/commercial/quotes` with `lines` equal to `{}`, `"bad"`, and `42`. All three threw `TypeError: req.body.lines?.some is not a function`; probe process exit 0. No server, database, heavy suite, or product edit was used. The probe isolates this pre-validation path; HTTP mapping was inspected, not exercised over a live connection.

## Bounded review coverage

Read the tracked diff plus untracked inquiry API, inquiry API tests, inquiry UI/helper/lineage components, frontend unit tests, browser journey, and independent probe source. Reviewed the approved contract and local acceptance summary. Publication manifest/audit finalization remains parent-owned.

- Auth/replay: inquiry middleware uses existing quote.read/write grants; all inquiry writes and durable replays call the transactional guard before receipt lookup (`inquiries.mjs:45-50,96-99`). Guard writes session, membership, user, tenant, plant and legal-entity fences (`app.mjs:141-155`). No new authorization bypass identified within this scope.
- Atomicity/concurrency: inquiry mutation, quote creation, receipt, history, audit and outbox are in the same Mongo transaction; tenant/plant/key and one-inquiry/one-quote unique indexes back the fences (`inquiries.mjs:3-5,71-82,96-107`). Inspected tests cover same-key replay, changed keys/payloads, cross-inquiry key collision, rollback, and fresh/replay revocation. No additional race blocker identified by static review; no heavy concurrency test rerun here.
- Source freezing: only DRAFT accepts source revisions; stage transitions are DRAFT → SUBMITTED → IN_REVIEW, with QUOTED set only by conversion. Quote conversion derives source-owned content and provenance on the server. Sourced commercial revisions reject altered descriptions/quantities/UOM/provenance and copy stored provenance (`commercial.mjs:120-123`). Approval/SO snapshots preserve it; shipment/invoice lineage is server-derived. No additional frozen-lineage blocker identified.
- Sensitive fields: conversion accepts a bounded commercial request and derives account/source metadata; UI renders source strings through React text, not raw HTML. No hardcoded secret, new exfiltration destination, or raw HTML injection found in the reviewed additions. Existing PDF metadata projection/schema is not expanded by this diff; tests explicitly assert provenance remains API/UI metadata rather than unversioned renderer fields.
- UI: scoped list/detail/create/revise/stage/convert routes, permission reuse, retained inquiry mutation keys on uncertain transport outcomes, source navigation, commercial-only sourced revisions, and shipment/invoice lineage displays were inspected. Browser journey uses actual persistence assertions and connected upstream fulfillment rather than synthetic UI-only lineage claims.

## Evidence and limits

`LEAD-ACCEPTANCE.md` reports maintained API 161/161, browser 88 checks, frontend 50/50, build exit 0, independent 5/5 probes and an independent 88-check browser run. Those are attributed owner/lead/QA results, **not rerun or independently certified by this read-only reviewer**. This review's executed evidence is the small actual-source malformed-input probe above; all other conclusions are source inspection. No Git mutation, product edit, heavy test, broker/cloud/shared PostgreSQL/private WhatsApp access occurred.

Full E01 remains **PARTIAL**. This is not production, statutory-tax, broker, lot/serial, genealogy, POD, full E01, or remote CI acceptance. Parent should resolve the direct-quote validation regression and refresh source-bound publication evidence before publishing.
