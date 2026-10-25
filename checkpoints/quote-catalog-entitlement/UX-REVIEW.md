# Catalog quotation UI review

## Design decisions

The existing English PF operations shell and ENERGY 1 / RHYTHM 1 / MOTION 1 direction remain. There is no new palette, typography, animation, asset, marketing panel or global navigation section. A separate catalog creation choice makes the cohort explicit. Kind, item code and business revision precede commercial terms, while quantities and prices retain their original strings. The current head's eligibility appears separately from frozen historical identity. Identical descriptions cannot create or imply a catalog match.

Catalog identity is retained in quotation revisions, approvals and the resulting sales-order snapshot. Primary evidence shows code, kind, revision, tracking policy, UOM and the frozen item description. The operator's commercial description remains separate. UUIDs, legal-entity identity, authority versions and hashes use permission-scoped Audit details. Item-master navigation appears only with its own read grant. This UI does not claim that catalog identity grants physical stock, production, dispatch or that the PDF renderer prints the binding fields.

## Delivery gate, current evidence

The lead's first owned focused run passed 8 grouped checks in 41.375 seconds, with zero exceptions and console errors. Three checks cover startup/authentication; one group discloses HTTP prerequisites; four cover the new native behavior. `quote-catalog-debug-results.json` explicitly records diagnostic-only execution, `fullAcceptance:false` and absent prior normal coverage. The following interaction groups were exercised in that run:

- Native kind and eligible-item selection; real prefix search and cursor pages; empty, loading and offline read recovery while retaining the selected revision.
- Native addition and removal of a temporary third line, preserving both prior bindings and all exact commercial input strings; native root refresh and the permission-scoped current-master link.
- Native two-line creation for manufactured SERIAL and purchased LOT; exact UOM and source identity checked against authoritative responses and independent Mongo records.
- Real current-item withdrawal refused by the server, native discard, explicit current-approved-revision selection, immutable prior revision and native revision save.
- Native Tab and Enter approval; actual committed response loss; locked sibling controls and exact command replay without duplicate durable effects.
- Native acceptance and conversion; committed conversion response loss followed by master drift; exact historical replay and immutable approved SO snapshot.
- Native Audit disclosure with full binding UUID/company/hash visible for wrap inspection. Native SO navigation and the blocked legacy manufacturing deep link.
- Quote-reader-only historical evidence without master grants; disabled write forms and revoked replay denial with role restoration.
- Actual viewport measurements and screenshots at 360, 768 and 1440: selected-item form, approved R2 binding with Audit open, SO binding with Audit open, and SO kiosk controls. The helper asserts exact 44/48px minimum control heights, unrounded text contrast thresholds, viewport width and zero document overflow.

The twelve actual feature screenshots are under `$PORTFOLIO_EVIDENCE_DIR/quote-native-attempt1/quote-catalog-{captured-source-form,approved-identity,sales-order,sales-order-kiosk}-{360,768,1440}.png`. Agent B independently viewed every frame. Chosen source, approved R2 identity, retained SO binding and opened Audit evidence remain readable at all three widths; company UUIDs and full hashes wrap without crossing their containers. Action links have visible separation. Kiosk controls preserve their larger target height. No blocking visual finding was identified in these frames.

The manifest reports twelve layouts with zero page overflow and zero sampled text-contrast failures. Minimum measured controls are exactly 44px in desktop mode and 48px in kiosk mode. This is a bounded rendered-text sample, not a site-wide contrast certification. The long native option description is truncated by the browser at 360px; complete selected code, revision, tracking and UOM remain visible immediately below. Single-line financial description inputs retain normal horizontal caret scrolling. Frames are scrolled sections, not full-page header captures.

Command submissions, links, Audit disclosures and buttons use trusted CDP mouse/keyboard input. Form values and select choices use native DOM setters plus input/change events. HTTP prerequisite creation is disclosed and shared with independent QA, rather than described as native user interaction or a third independent fixture. The quote-only run does not prove existing normal journeys. The lead's build attempt 1 passed, while normal all-21 and exact-head remote acceptance are still separate pending gates. Future stock fulfillment, PDF binding printout and the blocked F5 optimization are not accepted by this proof.
