# Work ownership and handoff

Lead owns integration, app registration, original customer E01/POD, source/legacy adapter coordination, CI, publication, resource scheduling and final acceptance. Agent reports are review input, not automatic acceptance. Maximum three child agents run concurrently.

| Lane | Owned implementation | Dependencies |
| --- | --- | --- |
| A backend/domain | catalog-options.mjs; catalog-procurement/internal-production; new catalog stock-use/internal execution modules; catalog-disposition current stock projection; focused owner tests | Sends request/response contract to B before integration; app.mjs registration handed to lead |
| B product/frontend | Portfolio UI/helpers/CSS; operator queue, friendly record labels and audit panels; paginated source selectors; focused frontend tests, shared browser runner and three new review journeys | API contracts from A/lead; lead retains DeliveryWorkspace.jsx; runner handed to B for canonical native integration |
| C independent QA/performance | qa/, CONCURRENCY.md, agent-c report, independent F1/F4/F5 probes and benchmark | Frozen54a7 baseline; no production edits or weakened owner tests; optimization would require independent reviewer |
| Lead | app.mjs; delivery.mjs and DeliveryWorkspace.jsx; business clock/customer labor guards; owned demo launcher; canonical E01 acceptance; .gitignore/workflows/publication/docs/manifests | Integrates only stable source; each heavy run gets an exclusive resource token |

Heavy resource order starts with C's baseline benchmark, then source-specific acceptance, independent probes and final API/browser in sequence. No user services are stopped. Only marker-owned test databases/processes are eligible for cleanup. Unit/syntax/source reviews can run alongside one heavy owner. All twelve pre-existing worktrees have before snapshots; no reset/clean/stash or unrelated commits.

Later explicit handoffs: A authored the mounted-HTTP E01 fixture driver and owner test, then adapted20 prior browser journey modules after B handed those files over. B retains the runner/new three journeys/readiness helper/kit, so both lanes never write the same browser files concurrently. C owns the independent required-labor proof. Lead executes integration/full-suite/browser/build/publication acceptance; reports remain inputs to that review.

Final metadata handoff: B authorized A to move internal UUID/hash/actor/version diagnostics into existing scoped Audit details across12 workspaces; no mutation bodies or event handlers changed. C independently reviewed the handoff. B retained browser/text helper ownership, adding preserved failure-time CSS and painted-text measurements without changing production CSS or existing font/overflow/keyboard assertions. C owns the bounded obsolete MAP vendor-fence snapshot adaptation; A independently reviewed it before runtime verification. Lead owns publication, final browser acceptance and clean reproduction.

Final closure handoffs: A updated three obsolete status predicates and the exact-receipt hold-action matcher after human labels replaced raw statuses/UUIDs; C verified all DB/quantity/lineage/PDF/race/replay assertions intact. B performed two final metadata-only presentation changes; C compared handler/href/value AST attributes unchanged. Lead executed exact clean build6/full9 and demo smoke3. C independently inspected the final149-check/E01 artifacts and ran a third guarded baseline-only window, preserving all previous data and source hashes. No optimization was accepted.
