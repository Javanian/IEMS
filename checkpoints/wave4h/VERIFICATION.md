# Wave4h publication-worktree verification

Lead exercised this separate worktree after clean npm ci in tenant-foundation, customer-service, document-rendering, portfolio-api, web and wa-demo-bridge. No original-checkout node_modules were borrowed. Mongo 7.0.14 resolved through mongodb-memory-server without MONGOMS_SYSTEM_BINARY; Chrome was the installed native browser. Real owned Mongo and synthetic business fixtures, not a simulated database.

Results, 2026-10-23:
- Earlier static audit: 168 manifest files, 204 relative import edges, zero errors as recorded by the publication lead. The finalization pass reruns the audit after documentation and test-entry updates; see the PR checks for the final count.
- API syntax check: exit0.
- Frontend portfolio units:44/44, zero skipped, exit0.
- Web production build:exit0; outdated Browserslist and large chunk warnings remain.
- Maintained API explicit27-file allowlist:155/155, zero skipped, exit0, duration284955.8601ms.
- Renderer historical suite:13/13, exit0; separate VAT suite:4/4, exit0.
- Renderer public TypeScript check (npm run check):exit0. Initial npm run typecheck was invalid because no such script exists; not claimed passing.
- Connected all-six-flags plus VAT browser:81 checks, exceptions0, consoleErrors0, exit0. CS enabled. Initial attempt failed at module resolution because bridge install was omitted from preparation commands; installed its locked dependencies and retained successful rerun separately.
- Mongo shutdown ECONNRESET diagnostics appeared after assertions. Recorded separately; test summaries and tool exit codes above were inspected.

Browser evidence is external and private. Raw lead logs remain in the original checkout's ignored wave4h evidence directory; no logs, databases, PDFs or screenshots are published in this commit.

Original checkout independently passed API155 and browser81 before publication integration. Independent C also passed canonical API/boundary probes and verified hashes, parsing, rasterization and visual review of four issued PDFs. Earlier independent browser failed a reload/revocation race; final harness now proves new-document readiness, genuine403/403/200 recovery, unchanged invoice and payment count. Original failure retained.

Historical Wave4g test expecting VAT PDF422 is unchanged and obsolete under the approved supported-PDF behavior (actual200). It is not part of the maintained27-file allowlist and is not claimed green. Full wildcard suite is NOT all green.

Boundaries: fixture tax policy only, no statutory compliance. NO_TAX schema1/templates1/2 remain; VAT quote/invoice use schema2/template3. Quote/SO VAT total is gross. Full E01, repair VAT, real brokers, production/shared-database remediation, live messaging, SAP, AWS and cutover remain unaccepted/outside this increment. No daemon/container was started.

These are local verification results at the integration checkpoint. Remote publication and checks are tracked on the dependent pull request; local results must not be presented as remote CI proof.
