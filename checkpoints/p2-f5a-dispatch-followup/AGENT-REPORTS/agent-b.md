# Agent B: P2 readiness and protected dispatch staging

Current lead result: final frontend196/196, build2 and focused native2 eight checks passed with zero application exceptions/console errors. The lead inspected all3 final exhausted-readiness PNGs. Pixel review of the earlier passing native1 prompted one condition-only warning refinement, frozen in agent-b-p2-source-freeze2.json, followed by these fresh gates. B's authoring-time statements below describe its own activity; native execution was performed by the lead. Final source/publication checks remain separate.

## Scope and design

P2 changes are confined to the company-stock UI/helper, focused frontend tests, a new readiness browser helper and its narrow call in the existing company-stock journey. The existing English PF layout, palette, permissions, retained-command locks and trusted command submissions are retained. Design dials remain ENERGY 1, RHYTHM 1, MOTION 1.

The primary view separates physical availability from permission to add a reservation. It explains reservation-history exhaustion and stock-event exhaustion in English. Capacity counters, transition-budget detail and the full server source remain in the existing permission-scoped Audit disclosure. Hold and hold-release forms consume their own authoritative readiness flags; reservation-count exhaustion does not disable them. No physical quantities, item binding, selected UUIDs, API bodies, history caps or retry semantics are changed by this UI lane.

The hard event cap can prevent later recovery. A permitted final-capacity reservation is not a promise that issue, consumption or recovery will fit; that limitation remains explicit in Audit details and the shared P2 contract.

## Verification performed by B

- Focused company-stock pure tests: 13/13 pass, including three new behavioral cases covering positive stock at count exhaustion, independent hold permissions, event-cap recovery refusal and the last legal event.
- Full frontend pure suite: 196/196 pass, zero failures/skips. Latest log: `$PORTFOLIO_EVIDENCE_DIR/frontend-attempt2.log`.
- Changed JSX, native-helper syntax and decoded static browser expressions parse successfully. These checks do not establish native runtime acceptance.
- No Mongo, Chrome, Vite, build, installation, commit or push was run by B in this lane.

## Native proof authored; not yet executed by B

The existing company-stock journey calls `portfolio-company-stock-readiness-browser.mjs`; no new diagnostic flag or independent full-coverage claim is introduced. The new helper uses the disclosed shared C fixture from `qa/support.mjs`: a real HTTP producer and 100 actual reserve/release pairs across five consumers, plus an unused consumer. This is shared prerequisite setup, not a third independent fixture and not native setup.

The authored browser checks positive physical/eligible stock with a disabled new reservation and its English reason, captures 360/768/1440 views, then uses trusted native mouse submissions to hold and release stock below the event cap. It checks physical conservation and reads the exact unit trace with all 100 abandoned claims. Measured control scope is the rendered reservation form; OS-native multiselect option rows and physical kiosk hardware are not certified. Screenshots, contrast and full normal regression remain pending the lead's runtime gate.

## Protected purchased-dispatch semantic staging

The original purchased WIP helper, test and Git index remain unchanged. Their before/after hashes are recorded externally in `dispatch-selector-staging/original-source-before.json` and `original-source-after.json`.

The actual original line-70 expression was extracted with Babel and executed in `node:vm`. Parsing passed, but execution raised `ReferenceError: orders is not defined` before any `querySelector` call. The new semantic test against the original copy records the expected RED result: one syntax test passes and one semantic test fails. The corrected external copy serializes the selector through the existing JSON helper; both tests pass. The semantic oracle checks the exact received selector, match, no match, absent root/link, and that the negative permission assertion fails when a forbidden link exists.

Evidence is external: `dispatch-selector-staging/original-selector-red.json`, `semantic-original-red-attempt1.log`, `semantic-regression-attempt1.log`, corrected copies and `dispatch-selector-correction.patch`. The patch is staged as an external artifact only; it has not been applied to the original WIP. No purchased browser gate, normal22, publication or acceptance is implied.

## Remaining gates

Lead-owned build, focused native proof and final normal regression are pending. A owns real boundary API evidence and C owns independent boundary/semantic review. F5 remains blocked pending its separate design/prototype verdict and later adoption/performance work; this UI change makes no F5 performance claim.
