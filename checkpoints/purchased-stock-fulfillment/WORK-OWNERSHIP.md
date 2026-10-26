# Work ownership

The new isolated `feat/purchased-stock-fulfillment` worktree starts at published head `692463a`. Sixteen older worktrees have before snapshots of HEAD, complete status and tracked diff hashes. Three original master-plan sources have SHA256 snapshots. No reset, clean, stash, branch switch or overlapping pull is used in those checkouts.

| Owner | Responsibility |
| --- | --- |
| A backend | Frozen contract, shared stock authority, customer demand and shipment proof, POD/billing adapters, owner tests |
| B frontend | Existing-route catalog fulfillment variant, source selection and recovery, pure and native browser checks, UI handoff and review |
| C independent QA | Independently authored HTTP and domain-CAS ordering checks, adversarial snapshots, QA review |
| Lead | Scope and source review, dependency installs, one-process gate scheduling, CI/publication audit, root checkpoint docs and publication |

Only the lead commits or pushes. The lead schedules one local heavy process at a time with at least2GiB free physical memory and no existing mongod. Unrelated user services are never stopped. Six package installs use actual checked-in lockfiles; no dependency junctions. Each attempt uses a fresh external evidence name, with full stdout/stderr and failures retained.

Contract is reviewed before writers start. Agents do not overwrite another lane's edits. Browser prerequisites may reuse the independent fixture with that reuse disclosed; this is not a third independently authored business fixture. The lead personally executes the UI delivery gate and reviews actual pixels.
