# IEMS integration evidence

Status: INTEGRATION_IN_PROGRESS. Local implementation handoffs are not independent acceptance.

The accepted base is `0ad4248af46adad2762763438efb27aaace932b4`. All twelve original producer handoff tips are ancestors of merged checkpoint `85a852384f57298c1759967c335fe45e2032edfe`. Feature histories remain intact. COMMIT-LEDGER.txt records the ordered history since that base; INTEGRATION.json records exact accepted handoffs. Branch tips can advance independently; they are not implicit integration inputs.

Data helper add/add conflicts were resolved to final data tip `32c78a9`, preserving its source bounds, tombstone reason, coalescing and source regression checks. Fulfillment's duplicate helper blobs match that version; its documentation conflict was only an extra trailing blank line. No vertical implementation was rewritten during integration.

SOURCE-MANIFEST.json enumerates thirteen actual producer/read-adapter paths, source commits and blob IDs. Manufacturing/customer-demand dispatch and canonical shipment adapters exist in the recorded handoffs. Manufacturing has no registered financial reporting resource; operations telemetry remains on its separate sample topic. Missing adapters and absent runtime publishers are not classified as wired.

FEATURE-MATRIX.json retains all 55 baseline assignments/contracts and adds implementation handoff and independent acceptance fields. Its original baseline decision field is historical. Every independent acceptance value is NOT_RUN. Optional Databricks remains PLANNED/EXTERNAL_DEPENDENCY. Cloud/provider credentials, real models, pilot data, biometric verifier, real legacy connections and speaker output remain explicit environment boundaries.

## Checks for integration mount changes

Run from the assigned integration worktree on merged checkpoint plus the app.mjs, PortfolioWorkspace.jsx and smoke source committed with this index:

| Command | Actual result |
| --- | --- |
| `npm --prefix apps/portfolio-api run check` | PASS, exit 0 |
| `npm --prefix apps/web run build` | PASS, exit 0; existing chunk size/Browserslist warnings |
| `node --test --test-concurrency=1 ops/demo/integration-smoke.test.mjs` | PASS, 1/1, exit 0; real owned Mongo and loopback HTTP |
| `node apps/portfolio-api/scripts/review-demo.mjs --synthetic-owned --smoke` | PASS, exit 0; inherited E01 settlement/proxy and marker-checked cleanup; Mongo ECONNRESET warnings retained |
| E02, full browser/security/concurrency/recovery/visual/accessibility QA | NOT_RUN |

Raw logs remain in the TPR-149 CTO checkpoint directory and the Paperclip integration-result document. Source inspection verifies fourteen permission-aware workspace mounts, authenticated installers, private initialization and no fabricated provider. Rendered visual acceptance is NOT_RUN, as required by final QA timing.

## Remaining acceptance blockers

1. TPR-146 must reconcile historical typed shipment and grouped settlement source parity against actual fulfillment handoff `7f7ed969`; its existing plan and owner were resumed for that correction.
2. Register private source reconciliation/coverage export and the single snapshot publisher/consumer with explicit authorization and independent Rabbit/domain/reporting markers. No trusted financial publication before complete verified coverage.
3. Supply SaaS effect admission and complete fenced domain export/archive/restore port. The mounted workflow currently fails closed without that port; subscription state does not yet gate existing domain effects.
4. Assemble linked E01/E02 launchers and walkthrough/reset contract, update the final ledger/manifest, and hand an immutable SHA to TPR-150. The inherited E01 command above is usable; it is not an E02 demo.

No public push, merge, deployment, paid service, live message or user-data migration occurred. QA candidate handoff is not yet issued.
