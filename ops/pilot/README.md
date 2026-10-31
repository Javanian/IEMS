# PLAT-033 pilot onboarding rehearsal

This tool reads two explicitly synthetic, owned JSON datasets. It never connects
to a database or imports source records. Schema is defined in rehearsal.mjs; use
the test fixture to construct sample UUID-scoped records. Only supported fields
are accepted. Record count is bounded at 1000; exact decimal strings and UOM are
preserved. Reconciliation hashes sorted stable identities and complete contents.

Run `node ops/pilot/rehearsal.mjs source.json target.json new-report.json`.
Output creation is exclusive, so an existing report cannot be overwritten.
Mismatch or invalid input exits nonzero. MATCH proves only synthetic file parity.

Pilot operator sequence:
1. Data owner inventories source authority, record IDs, units, currency and consent.
2. Owner approves mapping and scoped permissions separately from this rehearsal.
3. Create owned synthetic fixtures; rehearse mapping outside the domain collector.
4. Reconcile exported fixture inputs and target outputs. Resolve every mismatch.
5. Operator demonstrates login, plant selection, denied cross-tenant read, error
   recovery and reconciliation; record trainee, reviewer, UTC and evidence hashes.
6. Before a real migration obtain explicit authorization, immutable backup,
   maintenance window, rollback approval and independently verified permissions.

Configuration checklist: UUID tenant/entity/plant; selected-plant roles; supported
resource mapping; explicit units/currency; UTC cutoff; source and target digest;
data-owner signoff identity/date; operator training evidence; reviewer verdict.
Missing signoff/training/permission acceptance remains NOT_RECORDED or NOT_RUN.
No real pilot, production onboarding or migration acceptance is implied.
