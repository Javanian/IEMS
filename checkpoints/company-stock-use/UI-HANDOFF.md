# Company stock use frontend handoff

The implementation follows the frozen one-generation contract on baseline f4cf6fd. It keeps V1 planning and command payloads unchanged unless planning explicitly selects INTERNAL_PLAN_V2. The initial handoff below preceded connected runtime and build verification. The final section records subsequent lead-run evidence, the bounded presentation correction and the current source freeze.

## Operator workflow

Plan internal production includes the unchecked `schema` checkbox, value `INTERNAL_PLAN_V2`, labeled **Allow stored manufactured components (one generation)**. It uses a48px native target. V2 approved engineering materials display purchased material or manufactured company stock; execution schema derives from that approved plan.

The existing execution route retains its form labels. Purchased material uses the existing catalog picker. Manufactured material uses a separately keyed, paginated company receipt reader with exact item/revision filtering, explicit current-version review and actual company-unit UUID selection. Unit serials are the operator labels. Nothing is preselected or inferred from registry existence. Current stock evidence distinguishes on-hand, reserved, issued, consumed, available, eligible and terminal blocked quantities.

Typed output attribution and process loss use only this job's actual consumed company identities. Catalog and company source namespaces remain separate. Actual producer/item/revision/location, source unit states, direct purchased receipts and embodied purchased ancestry are readable; full IDs, source snapshots and fences stay in scoped Audit details. Terminal output retains physical stock but cannot supply another job or customer dispatch.

`/portfolio/company-stock/receipts/:id` is independently gated by company.stock.read. Reader/Holder roles need no internal-execution grant to inspect the receipt or use their permitted hold action. Producer links require internal.execution.read. Hold/release and paginated history share the retained-command boundary with page refresh and sibling commands. All V2 mutation controls reflect the additional company-stock grant, including output attribution. Existing PF styling, native controls, focus, desktop44px and kiosk48px rules are reused.

## Files

- `apps/web/src/features/portfolio/CompanyStockUi.jsx`: typed stock evidence, picker/detail, holds and history.
- `apps/web/src/features/portfolio/company-stock.mjs`: strict source-version and unit selection, reservation/hold/attribution builders and recovery text.
- `apps/web/src/features/portfolio/InternalProductionWorkspace.jsx`, `internal-planning.mjs`: explicit planning opt-in and typed material presentation.
- `apps/web/src/features/portfolio/InternalExecutionWorkspace.jsx`: V2 material, permission and provenance integration; V1 request shape preserved.
- `apps/web/src/features/portfolio/PortfolioWorkspace.jsx`: bounded detail-route registration only.
- `apps/web/test/portfolio-company-stock.test.mjs`: ten pure behavior tests.
- `apps/web/test/portfolio-company-stock-browser.mjs`: exported `companyStockJourney`, wired by lead under PORTFOLIO_COMPANY_STOCK.

No API, package/lock, root router, old browser helper, shared contract or resource-runner edits belong to this lane.

## Stable native controls

- Plan form **Plan internal production**: checkbox `schema`, existing item/location/quantity/reason fields.
- Reserve form **Reserve internal material**: `materialLineId`, company `companyReceiptId`, multiple `companyUnitIds`, explicit `quantity`, `reason`. Catalog fields retain their names.
- Attribution/loss: existing `quantity0..N`; company `companyUnitIds0..N`, where sources are consumed catalog rows first followed by consumed company rows, matching the current execution view arrays.
- Existing release, issue, operation, QC and putaway form labels remain unchanged.
- Company detail root `#internal-company-stock`: `data-company-stock-version`, `data-company-receipt-id`, `data-company-source-policy`.
- **Apply company stock hold**: `reasonCode` and `reason`; **Release company stock hold**: `reason`.
- Exact retry **Retry same production command**; discard **Discard production command and refresh**.

## Verification and limits

At the initial handoff, from `apps/web`, `node --test test/portfolio-company-stock.test.mjs` passed10/10. The then-current `npm run test:portfolio` passed172/172, zero failures/skips,3.96 seconds; raw external log `$PORTFOLIO_EVIDENCE_DIR/frontend-attempt3.log`. Four touched/new JSX modules parsed using @babel/parser; the native module passed node syntax. Ten literal evaluation expressions and22 interpolated expression skeletons also parsed. Every actual dynamic expression is parsed before browser evaluation.

The new browser helper uses the unchanged C-owned `qa/support.mjs` actual-HTTP producer setup, explicitly labeled as setup. New V2 and company hold actions use trusted CDP mouse or native Tab/Enter including char carriage return. It does not use DOM click for those actions. It independently checks reservation/lost-response replay effects, captured-source/sibling locks, company stock conservation, consumed purchased ancestry, producer physical counters/opening rows, customer financial non-effects, role-only reads/holds and revoked replay refusal. It authors360/768/1440 and kiosk screenshots and keeps the owner membership restored in finally.

At that initial handoff, the browser journey was authored but had not been executed. Build, real Mongo, connected native execution, screenshots and independent visual review were still lead-controlled gates; their subsequent results are recorded below with their source boundary. General manufactured installation graph, recursive reuse, customer dispatch, replacement, valuation/accounting and F5 remain outside this slice.

## Post-run presentation correction and final source freeze

Lead-controlled focused native attempt 1 passed seven diagnostic checks, zero exceptions/console errors, exit 0; its actual HTTP producer prerequisite is distinct from trusted native submission of the new commands. Multiselect values use DOM selection plus change events. Prior regression coverage is explicitly absent from that focused diagnostic. Lead then reported local full nineteen-journey attempt 1 passed153 checks with zero exceptions/console errors, exit0 and zero mongod. Both results precede the bounded corrections below.

Independent review of all twelve focused screenshots found sibling producer/company links touching at768/1440 and a current-eligibility label beside historical attribution inputs. After explicit post-run authorization, only `CompanyStockUi.jsx` and `InternalExecutionWorkspace.jsx` changed: the links now share an existing `pf-actions` wrapper; the purchased attribution/loss legend preserves receipt reference, lot/heat and UOM while saying **Consumed source for this job**. The stock picker still shows actual current eligibility. No quantity arithmetic, authority, payload, handler, permission or browser assertion changed.

After those edits, `npm run test:portfolio` passed172/172 with zero failures/skips/cancellations in5.784 seconds (`$PORTFOLIO_EVIDENCE_DIR/frontend-attempt4.log`). Four JSX modules parsed again and `node --check test/portfolio-company-stock-browser.mjs` passed. Source is frozen. This lane ran no heavy job.

Lead-controlled build attempt2 subsequently passed in31.06 seconds with194 PWA entries; lead reported maintained API278/278 passed. Final focused native attempt2 passed **seven diagnostic checks, zero exceptions/console errors, exit0 and zero mongod after cleanup**, independently confirmed from `$PORTFOLIO_EVIDENCE_DIR/browser-company-focused-attempt2/company-stock-debug-results.json` and `exit.json`. Its prior137 coverage remains explicitly absent; actual HTTP prerequisites, DOM-change multiselect and trusted native command submission are distinct as described above.

All twelve final screenshots were independently viewed at360/768/1440 across picker, typed attribution, terminal output and terminal kiosk sets. Both findings are closed: sibling links now have clear spacing at768/1440, and purchased attribution/loss says **Consumed source for this job** while retaining reference/lot/heat/UOM. No blocking clipping or visual issue was observed in the captured frames. This is not physical-device or screen-reader proof.

Only this handoff and Agent B report changed during final evidence review. The normal local153-check run predates the markup correction. Refreshed focused/build evidence is green, while **exact-head remote normal nineteen-journey regression remains a separate pending gate** at doc freeze; diagnostic seven-check results are not full regression acceptance.
