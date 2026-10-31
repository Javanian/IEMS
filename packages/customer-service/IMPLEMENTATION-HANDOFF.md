# TPR-144 implementation handoff

Owner: Backend Integration Engineer. Workspace:
`D:/Project AI/GITHUB/IEMS-worktrees/iems-all-20261030-service_portals`.
Branch: `program/iems-all-20261030-service_portals`. Local only; no public push,
merge, deployment, production data operation or external message was authorized.
The exact final branch tip, ledger and evidence are in
[implementation-result](/TPR/issues/TPR-144#document-implementation-result).

## Feature matrix and usable code commits

All local implementations below are IMPLEMENTED_QA_PENDING, subject to shared
mounting by TPR-149 and independent final QA TPR-150/152. The external provider
boundaries below remain EXTERNAL_DEPENDENCY, not accepted or silently omitted.

| ID | Implemented local behavior | Code milestones (all ancestors of final branch tip) |
| --- | --- | --- |
| PLAT-017 | Party-scoped customer order/repair status and per-line shipment quantities/UOM; vendor approved revision/hash reads, durable response/promise history; grant provision/revoke and replay authorization; both English portal screens | `84301c1`, `ef58f1f`, `b4653b3`, `b1891f6`, `5b7e0b9`, `a18c931`, `1be2e44`, `839ea02`, `ed8628b` |
| PLAT-046 | Reconciled accepted n8n workflow/lab, escalation/backlog/digest and approved resolution, due-task scan, bounded local SMTP and receipt reconciliation, credential fences; core CS works without n8n/AI | `8e67116`, `c5801f5`, `6993513` |
| PLAT-047 | Authenticated callbacks, durable delivery/provider-ID reconciliation, exclusive owner/generation, bounded lifecycle with UNKNOWN reservation, concrete installed local Chromium driver | `8a688f5`, `0a12fc5`, `1c8559b`, `79df6e9`, `75d28a9`, `8f77bfb`, `527da89`, `809dee1` |
| PLAT-051 | Metadata-only policy/config, prefix/allowlist/expiry/pause, source/identity/binding fences, queue and separate approval, atomic revocation/replay, foundation authorization, composed local runtime | `a2d13c4` through `eca31d8`; final composition `2124783` |
| PLAT-052 | Durable inquiry/draft/complaint/ticket/ack outbox; authorized same-session source projection and binding fences; manufacture and repair detail fixtures; no synthetic fallback on source failure | preserved core, `28b6a61`, `b38aa47`, `fd2f6ae`, customer read fences in `95d29da` |
| PLAT-053 | Inbox/conversation/ticket workflows, takeover and assignee resume guards, internal-note isolation, real persisted metrics with bounded coverage and ticket-specific confirmed response times; explicit synthetic/seeded/unknown provenance and English UI | preserved core plus `95d29da` |

## Prerequisite provenance

Accepted base: `0ad4248af46adad2762763438efb27aaace932b4`. Already incorporated:

- Platform `a56788350b551874ce654fc8eea89dea0145f83e`.
- Commercial `c7b8c4e265b942e5d4890fd9d5148dbbc85b94f3`, merge
  `cffff70c7e6657ff268aa9756f573c039020397a`.
- Data `32c78a979881063f0f939e6efb4a529438944fcc`, merge
  `c3cad32b7baf9cfff9e854d011ac6a1a634bd2b9`.
- Prior issue evidence records the accepted n8n source reconciliation; `8e67116`
  brings the selected automation/lab files without replacing the old application.

Fresh ancestry checks for platform/commercial/data returned exit 0 in the completion
run. Integrate this branch ancestry once; do not cherry-pick duplicate stacked
prerequisites or rewrite the integration branch history. No new prerequisite merge
was needed during the final continuation from `28b6a613`.

## Exact integration delta for TPR-149

Shared app/router/role manifest/lockfiles remain with the integration owner.

- Register `portalRoles` from `apps/portfolio-api/src/portals.mjs`; explicitly call
  `createPortalAccessService(runtime).initialize()` and
  `createVendorResponseService(runtime).initialize()` at owned startup, then
  `installPortals(app, runtime)` after authenticated selected-plant scope and JSON
  parsing, before shared error handling. No role implies a party grant. The
  endpoint/request/response contract is in `PORTAL-CONTRACT.md`.
- Mount named `CustomerPortalWorkspace` at `/portfolio/portals/customer` and
  `VendorPortalWorkspace` at `/portfolio/portals/vendor`, with authenticated shared
  navigation. No party enumeration endpoint is supplied; authorized users enter
  the resource references provided with their access. The vendor screen keeps
  same-command recovery per authenticated account/plant/user in tab storage.
- Register `automationRoles`/`automationActions`, call `initializeAutomation(db)`
  and `installAutomation(app,runtime,{fail,id,fields})`. Mount named
  `AutomationCenterWorkspace` at `/portfolio/service/automation`. Reconcile
  `ops/automation-lab` scripts against shared host setup; retain local transport
  receipt/UNKNOWN rules and do not enable real SMTP/WhatsApp.
- Preserve `initializeCustomerService`/`installCustomerService` and the existing
  CS routes. The initializer now uses owned `createServiceOrderReader`, with
  caller sessions forwarded to source reads. Do not replace shared `order-reader`
  or reporting helpers. `serviceOrderFixtures` is explicit fixture input, not an
  import-time seed or fallback.
- For the optional local provider host, construct `createLocalProviderRuntime`
  from `apps/wa-demo-bridge/src/provider-runtime.mjs` with fixed tenant/plant/account,
  the same DB transaction/foundation, trusted CRM directory and verification
  method list, host authentication, callback secret and installed-browser/scratch
  configuration. Explicitly await its `initialize()` at owned startup. Mount
  `operatorHandler` and `callbackHandler` on separate exact host routes before any
  JSON parser; preserve raw callback bytes and host origin/CSRF enforcement for
  operator commands. Only the trusted host calls start/stop. Do not expose browser
  lifecycle, CDP, source verification, dispatcher or registry methods publicly.
  See the bridge README for complete constructor and envelope contracts.

## External boundary and limitations

The concrete browser opens only `about:blank` in a fresh profile. It is a runnable
local lifecycle, not WhatsApp authentication or inbound collection. Provider-specific
login/navigation/inbound transport, externally verified source-assertion issuance,
real account/session credentials and actual provider callbacks require scoped access
and final independent QA. The host must not invent those inputs or promote synthetic
bindings to live identities. No real provider transport or send port is supplied.
`WA_LIVE_ENABLED` remains refused; runtime externalSendEnabled is always false.

No production migration, index creation, seed import, external credential operation,
cloud/paid service or live acceptance was performed. Index declarations were checked
with doubles only. Final Mongo isolation, denied-access races, crash/restart recovery,
real HTTP/API/DB integration, browser UI, visual/accessibility, stress/performance and
WA01-WA18 acceptance remain NOT_RUN for the final immutable integrated candidate.

## Completion-run minimum checks

- `node --test packages/customer-service/order-source.test.mjs packages/customer-service/order-binding.test.mjs packages/customer-service/service-operations.test.mjs`:
  18 PASS, 0 FAIL, 0 SKIP, using scoped/transactional doubles.
- `node --test apps/wa-demo-bridge/test/local-browser-driver.test.mjs apps/wa-demo-bridge/test/provider-browser.test.mjs apps/wa-demo-bridge/test/provider-lifecycle.test.mjs`:
  18 PASS, 0 FAIL, 0 SKIP with explicit installed local Chrome configuration. The
  real blank-browser open/close passed; registry/policy durability is not established
  by that smoke. Fresh process inspection found no remaining smoke browser.
- `node --test apps/wa-demo-bridge/test/provider-runtime.test.mjs apps/wa-demo-bridge/test/provider-operator-http.test.mjs`:
  9 PASS, 0 FAIL, 0 SKIP, including initialization gates and numeric/Date clock
  compatibility. These handlers were invoked in process, not through a real server.
- API syntax check, changed bridge JS checks, changed JSX compilation, UTF8 and
  final diff checks passed. One final web build and its exact result/hash are
  recorded in the issue evidence and checkpoint. Earlier build also passed; full
  independent regression was deliberately deferred.

Detailed checkpoint/evidence root:
`D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-144/6e70f0a8-d639-44c1-92db-0b23cdc10ab0/`.
Remote/CI and resolved runtime model remain UNKNOWN/UNVERIFIED. No service is left
running. The exhausted monitor count 30 and recovery audit are preserved; no monitor
reset, replacement monitor or stale hand-back endpoint was used.
