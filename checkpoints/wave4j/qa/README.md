# Independent serialized shipment probe

`serial-shipment-race.test.mjs` uses the actual authenticated HTTP app and marked disposable Mongo replica helper. From this directory the correct helper import is `../../../apps/portfolio-api/test/support/owned-mongo.mjs`: three parent traversals reach the repository root. Four would resolve outside the repository.

The fixture prepares three real serialized outputs in two work orders through commercial, procurement, warehouse, manufacturing and QC endpoints. It does not import or reuse provider test bodies. A second tenant has its own real commercial order for a cross-scope shipment check.

Assertions cover distinct-key concurrent shipment of the same accepted serial, one winning shipment/unit assignment/movement/audit/outbox/key, one increment in each of the source and sales-order tallies, exact replay with no added effects, reuse of the failed key for another accepted unit, foreign work-order unit and tenant source rejection, and replay revocation injected after middleware authorization but before the committing transaction fence. Full domain snapshots exclude session and membership authorization-fence counters intentionally.

The concurrent HTTP calls do not impose an internal two-writer barrier or prove every scheduler interleaving. This is one bounded race and authorization probe, not process-kill, all-revocation-kind, genealogy, full E01 or production acceptance. Helper teardown verifies its run marker, drops its own randomized database and closes its own server/client/replica.

The lead executed the independently authored probe sequentially: 5/5 passed, exit 0, no skipped or cancelled tests. Raw evidence is `D:/Project AI/GITHUB/IEMS-evidence/wave4j-20261024/lead-independent-serial-race.tap`. Mongo teardown ECONNRESET diagnostics remain in that successful log. The author performed source/path/syntax checks and did not run the heavy test; authorship and execution are distinct.
