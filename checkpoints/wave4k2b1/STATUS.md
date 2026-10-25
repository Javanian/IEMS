# Received-only installation status

K2b1 is implemented and locally accepted on `feat/manufacturing-serial-installation`, baseline accepted K2a `f2d6f4a5883281e8455a353d9d83c14c50698aab`. Use git log -1 for the accepted checkpoint commit. No push, merge or deployment is included.

New explicitly required WOs record exact received CONSUMED input identities against their own output parents. Active installation and explicit process-loss dispositions are permanent/add-only, with immutable revisions/events and source versions. Removal records permanent REMOVED_QUARANTINE and leaves completion blocked. Inventory and claimed quantities never become available again through these commands.

| Gate | Executed evidence |
| --- | --- |
| Owner targeted HTTP | Attempts1/2:9/9 pass; final maintained run also includes9/9 on the final integrity fix |
| Maintained API |34 files,214/214 pass, zero skips |
| Independent adversarial HTTP | Final attempt3:10/10 pass, zero skips |
| Frontend |83/83 pass, zero skips |
| Web production build | Pass including PWA195 entries; existing warnings retained |
| Connected Chrome, all12 switches | Attempt1:117 checks,0 exceptions,0 console errors, exit0 |
| Layout and visual evidence | Three installation states at1440/768/375/360; representative desktop/mobile screenshots inspected |
| Source/import audit and evidence hashes | Final source-audit.json and verification-manifest.json in external evidence |

Raw evidence is external at `D:/Project AI/GITHUB/IEMS-evidence/wave4k2b1-20261024/`. LEAD-ACCEPTANCE.md records the practical boundaries and preserved failure. CONTRACT.md, HANDOFF.md and UI-HANDOFF.md describe the implemented slice.

Manufactured-child ownership/stock custody, general ancestry/cycle acceptance, authorized rework/spares/replacement, returns/inspection, POD and full original E01 remain open. MANUFACTURED-CUSTODY-DESIGN.md is a draft continuation design, not frozen runtime authority. Supplemental received serial fixtures do not add serials to canonical E01.
