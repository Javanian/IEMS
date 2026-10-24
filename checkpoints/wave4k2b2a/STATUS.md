# Inventory authority and internal planning status

K2b2a is implemented and locally accepted on `feat/manufacturing-internal-planning`, baseline accepted K2b1 `cfb1b989b45fa7b02d8e24cfa51e52679a48bf3e`. Use git log -1 for the accepted checkpoint commit. No push, merge or deployment is included.

Scoped inventory item revisions and independently qualified company locations now support separate internal production plans and versioned engineering demand. Owner is derived from the active selected plant. Only current approved item revisions and qualified company locations authorize fresh planning/approval. Old snapshots remain readable while changed dependencies add live blockers.

| Gate | Executed evidence |
| --- | --- |
| Owner targeted HTTP | Attempt2:7/7 pass, exit0, zero skips |
| Independent adversarial HTTP | Attempt1:12/12 pass, exit0, zero skips |
| Frontend |96/96 pass, zero skips |
| Web build | Pass including PWA195 entries; existing warnings retained |
| Maintained API |35 files,221/221 pass, exit0, zero skips |
| Connected Chrome, all13 switches | Attempt1:125 checks,0 browser exceptions,0 console errors, exit0 |
| Layout and visual evidence | Approved/revoked sections at1440/768/375/360; representative desktop/mobile screenshots inspected |
| Source/import audit and evidence hashes | Final source-audit.json and verification-manifest.json in external evidence |

Raw evidence belongs outside Git at `D:/Project AI/GITHUB/IEMS-evidence/wave4k2b2a-20261025/`. LEAD-ACCEPTANCE.md distinguishes fixture setup, native actions, negative-effect proof and remaining limits. CONTRACT.md, HANDOFF.md and UI-HANDOFF.md describe current behavior.

APPROVED_DEMAND is planning approval only. Every order read exposes execution NOT_IMPLEMENTED and canExecute false. No execution WO, finished serial, stock availability, shipment, financial entitlement or valuation is created. Actual source-item mapping, internal execution/QC/company-stock receipt, manufactured graphs, replacement, POD and full original E01 remain open. RECEIVED-ITEM-MAPPING-DESIGN.md is a reviewed draft proposal, not an implemented or frozen contract.
