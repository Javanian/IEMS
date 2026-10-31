# PLAT-034 recovery and incident rehearsal

The executable backs up/restores only the PLAT-033 synthetic file schema. It does
not back up Mongo, object stores, users, credentials or a production tenant.
No database/consumer/service process is started or stopped by these commands.

Startup: `node ops/recovery/rehearsal.mjs backup source.json new-backup.json`.
Health/parity: `node ops/recovery/rehearsal.mjs rehearse new-backup.json source.json new-report.json`.
Outputs are exclusive-create; preserve old evidence. Invalid hash, scope, age or
parity exits nonzero. Elapsed time is measured for in-memory restore only. Backup
age measures fixture age, not source RPO. Production SLOs stay NOT_RUN.
Shutdown: command exits with no listeners or background workers.
Rollback: retain original fixture; discard only the new owned restored fixture
after inspecting paths. No deletion is automated.

Incident procedure:
1. Name incident commander, severity, affected scope, UTC and last known revision.
2. Inspect process/listener/data-directory ownership before any lifecycle action.
3. Stop admission through the approved maintenance gate, never kill unrelated PIDs.
4. Inventory legacy consumer groups, offsets, in-flight work, outbox backlog and
   duplicate/replay behavior. Record drain to zero before a separately authorized cutover.
5. Restore an isolated backup using the database owner's version-pinned toolchain.
   Verify integrity, record conservation, exact units/currency, grants and tenant isolation.
6. Measure actual restore/start/health time and source cutoff loss against approved
   RTO/RPO; record failures separately. Rehearsal report cannot establish these SLOs.
7. Roll back application/config to last immutable candidate if checks fail; retain
   original DB and offsets. Do not resume two writers or replay unknown effects.
8. Reviewer approves reopening admission. Preserve logs/hashes and follow-up owner.

Actual database restore, managed backup retention, incident exercise, consumer
drain and hosted monitoring require authorized environment inputs and final QA.
