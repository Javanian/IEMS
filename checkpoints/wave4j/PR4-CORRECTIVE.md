# PR4 prerequisite corrections and bounded Wave4j review

Scope: local `manufacturing-lot-serial` worktree based on PR4 head `8324b0294677f2f9273f144eddc51b4b026a07ab`. The remote PR4 and original dirty checkout were not changed by this agent.

## Corrections

1. Sourced commercial revisions compared provenance using `JSON.stringify`, rejecting identical key/value objects when JSON property order changed. The actual imported handler reproduced 200 for the original order and 422 `SOURCE_TAMPER` for reversed order. `commercial.mjs` now uses Node's `isDeepStrictEqual`, retaining exact keys, types and values while ignoring object property order. Successful revisions still clone stored provenance, preserving its stored representation.
2. Inquiry creation exposed only a CRM-backed account picker, but the authorized `quoteEditor` role has `quote.read`/`quote.write` without `crm.read`. `InquiryWorkspace.jsx` now renders a required known customer account ID input for identities without CRM read permission. CRM readers retain the existing paginated picker. The picker owns its resource hook, so known-ID creation and inquiry revisions do not perform an unnecessary CRM lookup. No role grants changed.

The UI keeps established field, panel, focus and typography styles. The additional input serves the specific task of entering an already known scoped customer; explanatory text states the browsing limitation. No new styling, palette or visual assets were introduced. Existing operational form direction is retained.

## Executed lightweight checks

- Actual imported commercial handler with an in-memory route/transaction/database stub: reordered provenance returned 200 and retained stored key order; extra key, missing key, changed type, changed value, null, array and omitted provenance each returned 422 `SOURCE_TAMPER` with zero stub writes. Eight cases passed. This probe does not certify real Mongo transaction behavior.
- `node --test test/portfolio-wave4j-pr4-corrective.test.mjs test/portfolio-wave4i-inquiry.test.mjs` from `apps/web`: exit 0, 7/7 tests, no failures/cancellations/skips. The new test bundles and server-renders the actual `NewInquiry` form with real React/router and a fixture resource adapter. It verifies quoteEditor gets an enabled required known-ID input with zero CRM resource calls, and CRM readers retain the account picker and paginated lookup. This is component rendering, not browser proof.
- Initial new UI-test attempt failed because the ESM bundle could not resolve a CommonJS builtin require. The fixture evaluator was corrected to CommonJS execution; product behavior and assertions were not weakened. That initial harness failure is distinct from the passing rerun.
- `node --check` passed for corrected commercial source, new API regression and additive browser module. Scoped `git diff --check` passed.

## Tests authored for lead execution

- `apps/portfolio-api/test/wave4j-pr4-corrective.test.mjs`: maintained real-HTTP/owned-Mongo regression. Covers semantic provenance order, exact stored source preservation, seven tamper variants with unchanged quote/audit/outbox snapshots, and quoteEditor known scoped account creation while CRM browsing remains denied. Foreign and missing accounts remain concealed with 404. Not executed by this agent; lead owns the maintained suite.
- `apps/web/test/portfolio-wave4j-pr4-browser.mjs`: additive `quoteEditorInquiryJourney` for the lead's existing browser harness. Uses the real membership and API, verifies CRM denial and quote-write permission, creates an inquiry by typing its known account ID and keyboard submission, checks exact persisted source and hard reload, then restores membership and hard reloads in `finally`. Not executed by this agent; lead owns browser integration and execution.

## Independent Wave4j API source review

Read-only inspection of warehouse, manufacturing and fulfillment additions found no additional actionable blocker at the reviewed source snapshot. This is independent source review, not a rerun or certification of provider tests.

- Existing scoped authorization is reused; transactional guards precede receipt lookup on fresh writes and replays. New output-unit reads retain tenant/plant/work-order filters.
- Material identity is server-derived from stored receipts; manual and engineering release share the same reservation/trace construction loop. Consumption copies released routing materials. Final output and shipments copy stored material context; caller trace fields remain outside allowlists.
- Serialized final output creation and its shared serial registry entry occur in the same transaction as operation/stock/audit/outbox/key effects. Scoped unique indexes cover the shared received/manufactured serial namespace. Duplicate-key retries use fresh guarded transactions.
- QC requires exact disjoint accepted/rejected partitions and matched unit counts. Shipment requires source-work-order accepted serials, exact counts, and atomic ACCEPTED-to-SHIPPED unit updates with matched-count fences. Stock/source/order tallies and shipment effects share the transaction.
- Omitted lot/heat and serialization preserve legacy quantity contracts; extra serial fields on unsupported operations are rejected. No financial arithmetic, renderer schema or issued-document code was changed in these additions.

Reviewed source SHA-256 snapshot:

- `warehouse.mjs`: `be06a91a927f205a13b82855d759e99ec1a8fe16b3666c9c175555fe93bfb0c4`
- `manufacturing.mjs`: `bec1e3f807a4982010a9ab0af7c2a2ca6ba2ff1a2c2c679c60d578624badf1a8`
- `fulfillment.mjs`: `cfd14070224cd6cf752660d315a22945434837b13a4f2cb1660b99e40fbc5cf2`

No services, Mongo replicas, heavy tests, Git commits/pushes or external writes were started by this agent. Full HTTP/browser/build gates remain lead-owned and pending here. These corrections and this source review do not establish full E01, production, genealogy or POD acceptance.
