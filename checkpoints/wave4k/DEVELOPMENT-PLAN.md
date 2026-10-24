# Development after consumed-lot attribution

This file continues the accepted Wave4j development plan. Bounded K1 local acceptance is complete; STATUS.md and LEAD-ACCEPTANCE.md record its evidence and limits. The full prior invariants remain in `../wave4j/DEVELOPMENT-PLAN.md`; do not read its historical PLANNED labels as a current completion report.

## Next: K2 contract before serial installation

Freeze incoming component serial custody before writing installation commands. Existing serial registry membership proves uniqueness, not available stock or authority to consume it. New serial claims must precede consumption and share committing fences with quantity reservation/consumption, transfer, count/adjustment, hold and dispatch. Already-consumed K1 materials need an explicit evidence-adoption policy or remain unrecorded for K2; they cannot become fresh free inventory.

Define permitted parent/child states, unique active-parent authority, controlled removal/replacement and inspection before any return to stock. Manufactured children need a common custody fence with shipment. Reject quarantined, rejected, shipped, already installed and foreign units. Define a shared graph revision/fence that prevents simultaneous reciprocal installations and fail closed if traversal exceeds a bound. Keep supplemental component-serial fixtures separate: canonical E01 incoming materials have lot/heat identities without incoming serial IDs.

API and UI may split into parallel lanes after this contract is reviewed. Independent QA authors adversarial cases separately: competing parents, reciprocal cycles, installation versus shipment, claims versus every stock writer, rollback, replay/revocation and exact stock/custody reconciliation. K1 alone does not complete Wave4k.

## Then: delivery and canonical acceptance

Wave4l uses a separate versioned delivery aggregate for partial/completed POD, dispatched-unit entitlement, reported occurrence versus receipt time, actor/reason/evidence and append-only corrections. A historical shipment, issued PDF or invoice balance must not be rewritten. Existing billing policy is unchanged. Provider verification, uploads and customer messaging need their own authority and evidence.

Wave4m begins after K2 and POD gates. Independent QA freezes the original E01 fixture hash and identity/parity matrix first. Match five source lots, ratios1/1/1/2/1 with UN/SET, ten outputs/WO6/4, engineering identities, four execution sessions, workcenters/skills/labor, QC certificates/inspectors, acceptor/PO links, entitlement, two PODs and original financial totals. A final balance alone cannot substitute for missing execution or QC. Historical fixture dates require a trusted clock or explicit owned-test adapter; never edit fixture dates or backdate commits. Unsupported runtime behavior stays a named gap.

## Checkpoint and publication

Each accepted slice keeps its frozen contract, current backlog, source/import audit, preserved failure evidence and scoped local commit. Revalidate the actual published head and CI before any remote merge. PR4 prerequisites and the two accepted local Wave4j corrections still require a coherent publication decision. No local test result implies production, live SAP/WhatsApp/broker, statutory tax or cutover acceptance.
