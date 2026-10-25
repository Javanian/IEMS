# Controlled catalog receipt QC and putaway status

Implemented and locally accepted on `feat/catalog-receipt-qc-putaway`, baseline `ae0602a7a24f87050b66e754d86eef4f0b38ca50`. Use `git log -1` for the accepted checkpoint commit. No push, merge or deployment is included.

Actual catalog receipts now support immutable inspection revisions with an explicit exact LOT quantity partition or exhaustive actual SERIAL identity partition. Terminal approval creates dedicated accepted pending stock and rejected quarantine. Whole accepted stock may be put away once into a currently qualified company location and real active bin. Dedicated typed balances, serial units and one stock movement retain the source, inspection and captured location authority. Original received quantity, UOM, lot/heat, supplied serials, origin, RECEIVE and global registry remain unchanged; legacy warehouse counters stay zero.

Physical typed stock and live eligibility are separate: later holds, item changes or withdrawn location qualification can reduce eligible quantity to zero without changing stored history. `canAllocate` and `canExecute` remain false. Rejected stock has no return, rework, resale or internal consumption path. Approval is terminal; no correction after approval is supported.

| Gate | Executed evidence |
| --- | --- |
| Owner HTTP final | Attempt2:10/10 pass, exit0, zero skips; includes100 real revisions |
| Independent adversarial HTTP | Attempt1:15/15 pass, exit0, zero skips |
| Prior independent regression | Five suites,57/57 pass, exit0, zero skips |
| Maintained API |37 files,240/240 pass, exit0, zero skips |
| Frontend | Attempt1:120/120 pass, exit0, zero skips |
| Web production build | Attempt1 pass including PWA195 entries |
| Connected Chrome, all15 switches | Attempt1:137 checks,0 browser exceptions,0 console errors, exit0 |
| Layout and visual evidence | LOT/SERIAL inspection and typed stock at1440/768/375/360; keyboard approval and44px controls; screenshots reviewed |
| Source/import audit and external hashes | Final source-audit.json and verification-manifest.json in external evidence |

Raw attempts, screenshots, cleanup and hash verification belong outside Git at `D:/Project AI/GITHUB/IEMS-evidence/wave4qc-20261025/`. LEAD-ACCEPTANCE.md and qa/README.md bound the evidence. Passing Mongo teardown may log ECONNRESET; existing build warnings are retained. No warning-free execution is claimed.

Eight prior checkout HEAD/status snapshots are preserved, including65 dirty original main entries and two untracked CRM TAP files. Canonical E01 fixtures are unchanged. Separate actions do not enforce two-person approval. Location/source selectors remain bounded to the first100 current candidates. Typed allocation, mixed-policy internal execution, company-stock output, manufactured provenance/replacement, supplier returns/rework, POD and full E01 remain open; DEVELOPMENT-PLAN.md and BACKLOG.csv describe the next gates.
