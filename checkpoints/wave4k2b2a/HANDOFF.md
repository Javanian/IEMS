# Internal planning continuation handoff

Worktree `D:/Project AI/GITHUB/IEMS-worktrees/manufacturing-internal-planning`, branch `feat/manufacturing-internal-planning`, baseline accepted K2b1 `cfb1b989b45fa7b02d8e24cfa51e52679a48bf3e`. Read current status and Git diff before continuing. Preserve original dirty main, CRM evidence and previous accepted worktrees.

The API lane owns internal-production.mjs and app registration. Masters and internal planning use separate collections and dedicated capabilities. Every mutation has committing authorization before durable replay, scoped canonical body hashing, atomic event/audit/outbox/key and real dependency writes. Owner is derived from the selected active plant inside that transaction. New item revisions reset approval; inactive item/location profiles are terminal in this slice. Withdrawal of existing planning approval does not create or free stock.

UI uses separate master/internal workspaces, immutable history and current dependency blockers. Approved source snapshots remain historical while live readiness can become false. All retained-command forms and dependent pickers lock through uncertain acknowledgement; retry sends the captured body/key. Current master source selections use bounded100-row reads. List/history pages support UUID cursors; do not infer unbounded picker capacity or all-master load acceptance.

Content revisions bind their identity/content/reason/actor/time through contentHash. Authority events bind their semantic head snapshot; event envelope reason/actor/time are append-only through the API but outside the snapshot authority hash. This is local authority-integrity evidence, not a tamper-proof external audit service or separation of persons.

Actual inventory item/source equivalence, execution origin, material reservation/issue, QC partition, company-stock receipt and manufactured graph remain future contracts. APPROVED_DEMAND never means execution RELEASED. Every read retains execution NOT_IMPLEMENTED and canExecute false. There are no output/stock/valuation/financial effects.

Disposable Mongo checks are serialized against owned marked replicas; do not stop shared databases, brokers or browser sessions. Existing locked dependencies are reused by node_modules junctions without package/lock changes. Raw evidence belongs outside Git at `D:/Project AI/GITHUB/IEMS-evidence/wave4k2b2a-20261025/`; do not commit raw TAP, screenshots or test databases. Publication and production/live-provider proof remain separate.
