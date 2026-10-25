# Development after received identity custody

Continue from accepted K1 and the bounded K2a local acceptance recorded in STATUS.md. The original Wave4j K2/L/M invariants remain authoritative; this split prevents a received serial claim from being presented as an installed component graph.

## K2b contract next

Define a controlled consumption-to-installation transition for incoming CONSUMED identities that never makes consumed inventory free again. Each exact identity needs a stable parent output unit from its recorded WO or an explicitly reviewed transfer path. Resolve ratios, rejected/scrap inputs and incomplete installation without automatic equal assignment. Legacy/K1 consumed sources remain UNRECORDED unless a separate evidence-adoption policy is reviewed.

Manufactured components need an explicit inventory/custody transition with a common fence against QC disposition and shipment. ACCEPTED alone is insufficient. Reject shipped, rejected, quarantined, customer-owned, already installed and foreign units. Freeze the source and parent states before implementing endpoints.

Enforce one active parent with scoped uniqueness. Installation must reject self-links, duplicate children and cycles through a shared graph revision/write fence. Bound traversal and fail closed when the bound is reached. Independently test simultaneous A->B/B->A, competing parents and installation-versus-shipment. Read-only traversal or independently checked snapshots alone do not serialize graph writes.

Removal and replacement retain append-only events, prior source evidence and actor/reason. A removed component does not return to available inventory until a separately defined inspection/custody transition permits it. Rework, disassembly, repair, returns, cancellation after reservation and identity-aware quantity adjustment need explicit policy; K2a does not create shortcuts for them.

API/UI lanes may run in parallel only after the K2b contract is frozen. Independent QA keeps supplemental serial fixtures separate from canonical E01, which has only received lot/heat identities. Do not close complete Wave4k from K1 or K2a alone.

## Delivery and full acceptance remain later

Wave4l requires versioned partial/completed delivery with exact dispatched entitlement and immutable corrections, separate from historical SHIPPED, billing and PDF records. Preserve reported occurrence versus server receipt time and operator evidence versus verified provider proof. Keep current invoice policy unless expressly changed.

Independent Wave4m freezes canonical fixture hashes and a parity adapter only after complete genealogy and POD. Preserve five sources/ratios/UOMs, WO6/4, ten outputs, actual engineering identities, four labor sessions/workcenters/skills, QC certificate/inspector/signoff, acceptor/PO and entitlement links, two PODs and original financial totals. Historical dates need a trusted owned-test clock or documented adapter; never edit fixture dates or invent missing runtime behavior. A balance alone does not prove the chain.

Every accepted slice gets evidence hashes, a source/import audit, scoped local commit and explicit remaining gaps. Eventual publication must reconcile the PR4 prerequisites and local corrections and test the actual published head. Local validation is not a merge, cutover, broker/live SAP/WhatsApp or production gate.
