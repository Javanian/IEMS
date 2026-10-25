# Independent K2a custody-ordering probe

`custody-ordering.test.mjs` uses authenticated HTTP and the owned marked disposable Mongo helper. It prepares supplemental incoming serials, receipts, a real commercial order and two required PLANNED WOs. Canonical E01 is not altered or used as a source of nonexistent incoming serial IDs.

The independently authored assertions cover both legacy-reservation/adoption orderings, permanent quantity-path denial after abandon, manufactured-origin registry corruption, malformed inactive holds, claim/abandon versus WO release in both safe orderings, ratio2 reservation of four input identities for two outputs, a later source hold before consumption, transactional audit failure rollback, zero-good input consumption once, exact replay and membership revocation injected after middleware authorization before replay's committing guard.

Deterministic interventions commit through actual HTTP before the target transaction guard. These are controlled command orderings, not an internal two-snapshot concurrency barrier. The existing guard writes shared tenant/plant documents, so nesting a same-plant HTTP writer inside an already-guarded transaction would wait on the outer transaction. Common receipt/WO/unit CAS fences require source review as additional evidence.

An invalid hold cache, manufactured-origin registry contamination and trailing duplicate in a persisted claim's serial list are deliberate direct fixture injections, restored in finally. An owned collection validator injects the audit failure and is restored in finally. Business snapshots exclude entire sessions, memberships, users, tenants, plants, legalEntities and credentials collections plus the owned-run marker; they do not certify unrelated authorization-record immutability. They include custody/warehouse/manufacturing/genealogy/fulfillment ledgers, events, projections and keys.

This probe does not cover every stock writer, engineering release, all migration histories, all revocation kinds, maximum20-source/max100-identity load or graph invariants. Provider/lead evidence must cover the remaining K2a contract. No K2b parentage/installation/cycles, POD, full E01 or production claim follows.

Lead executed this independently authored probe after the owner handoff:11/11 pass (ten child cases plus parent), exit0, no skips. Raw evidence is independent-custody-ordering.tap in the external K2a evidence directory. Syntax/path checks alone are not HTTP acceptance. The helper validates its marker and tears down only its own server, randomized database, client and replica.
