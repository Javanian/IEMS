# Master-plan mapping and current boundaries

Requirement source is the original local `docs/refactor-2026-10-20/MASTER-PLAN.md`, `BACKLOG.csv` and `DATA-MODEL.md`. They are dated planning artifacts in the protected original checkout; they are not rewritten or copied wholesale into this increment. Source hashes are retained in external evidence. Current implementation was checked directly because the active worktree has no current Graphify graph.

| Original backlog | This increment | Remaining master-plan scope |
| --- | --- | --- |
| P020 stock ledger/reservations | Exact serialized company output claims, current balances, release/issue/consume and dedicated holds | General transfers, valuation and other stock policies |
| P026 material/WIP/good/scrap | Actual mixed purchased/company input, immutable movements and exact output/loss attribution | Broad WIP/rework policy and all shop-floor cases |
| P027 assembly/genealogy | Typed one-generation source-unit provenance with immutable terminal descendants | General graph uniqueness/cycles, removal/replacement and multiple reusable generations |
| P031 typed fulfillment | Existing customer/legacy dispatch guards remain enforced | Authoritative sales-line inventory item entitlement is a prerequisite for future company-stock dispatch |
| P042 acceptance | Actual HTTP/DB/native browser, scoped source race, replay/revocation/rollback and current-head CI | Platform-wide capacity, PostgreSQL, hardware/providers and production pilot |

K2B2-03/04 identify the new dependency. Historical MAP/QC/internal execution/company-receipt rows marked PLANNED have already been implemented within the parent F1/F4 acceptance bounds. General K2B2-05/06 and replacement remain later gates; this increment does not relabel them complete. The original canonical E01 fixture remains unchanged. Manufactured-input production is a separately labeled supplemental journey.

The master plan's PostgreSQL/modular API migration is a broader target. This checkpoint extends the actual Mongo-backed portfolio runtime and cannot certify that migration. F5 measured shared-fence contention remains BLOCKED under its unchanged ADR/guards; this work preserves those fences rather than accepting a new authorization protocol.
