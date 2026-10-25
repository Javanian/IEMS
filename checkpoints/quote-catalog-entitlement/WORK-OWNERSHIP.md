# Ownership and preservation

All changes belong to the isolated `feat/quote-catalog-entitlement` worktree, based on the published company-stock-trace checkpoint. Fifteen older worktrees have before snapshots of HEAD, status and tracked diff hashes. Three original master-plan sources have SHA256 snapshots. No reset, clean, stash, branch switch or overlapping pull is used in those checkouts.

| Owner | Files and responsibility |
| --- | --- |
| A backend | Commercial catalog contract, domain validation, routes and owner tests |
| B frontend | Explicit picker and frozen evidence presentation, frontend behavior tests and native browser journey |
| C independent QA | Separately authored HTTP fixtures, adversarial authority proof and QA review |
| Lead | Scope review, integration, dependency installs, CI/source audit, checkpoint docs and publication |

The lead schedules one local heavy process at a time. Owned Mongo or Chrome work requires an explicit slot, at least 2 GiB free physical memory and no existing mongod. Unrelated services are not stopped. Six package installs use the actual checked-in lockfiles without junctions. The lead retains full attempt logs, including failures and nonfatal diagnostics, outside the repository.

Browser setup may reuse the independent HTTP fixture, with that reuse disclosed. It is not a third independently authored business fixture. Agents do not commit or push; the lead reviews and publishes only after the relevant gates pass.
