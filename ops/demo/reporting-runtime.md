# Private reporting runtime

This is a marker-owned, bounded **LOCAL_FILE / SYNTHETIC** composition. It reuses
`createReportingSource`, `relayReportingSnapshots`, `createProjectionConsumer`
and, when explicitly configured, `jobs/analytics/raw.py`. It creates no public
ingestion route and never changes domain authority. Local Mongo resources are
read-only reporting projections, not another business ledger.

## Exact initialization and close delta for CTO integration

Import `createReportingRuntime` from `ops/demo/reporting-runtime.mjs`. After
opening the explicitly owned synthetic source client and initializing the
existing foundation, call:

```js
const reporting = await createReportingRuntime({
  db, client, foundation,
  getScope,            // reacquire the authenticated foundation scope privately
  authorizeResource,  // mandatory current resource policy in supplied transaction
  root, marker,       // existing explicit synthetic ownership, never .env fallback
  mode: 'LOCAL_FILE',
  rawSink,            // optional {kind:'PARQUET', commit(event), close()}
});
try {
  const { manifest } = await reporting.reconcile({ limit: 1000 });
  await reporting.extract(manifest.runId); // full immutable replay, then coverage
  await reporting.relay(100);             // subsequent pending live snapshots
} finally {
  await reporting.close();
  await client.close(); // runtime borrows the source client; its owner closes it
}
```

`reconcile` accepts only the scan limit; callers cannot substitute a different
scope. `getScope` must use current foundation authentication, never construct a
grant from caller IDs. Both `quote.read` and `fulfillment.read` are required for
this combined lane. Reuse existing roles or an explicitly authorized private
identity with these actions; this delivery creates no user, role or permission
grant. The CLI derives only these actions from existing commercial/fulfillment
role definitions, including their existing owner composition. Unknown and
revoked identities/resources fail closed. Source reads use the exact cohort
and authority validators from the corrected adapter, including referenced
orders, invoices, typed shipment proof and settlement authority. Primary
resource authorizers are called inside their transaction on every replay;
false returns deny as well as thrown errors. Source scope, active/revoked and
allowed-user restrictions are also enforced by the adapter.

Before connecting, CLI validation requires a literal loopback Mongo URI with
explicit port, no credentials, an explicit `portfolio_test_<32 hex>` database,
and an existing absolute extraction root containing `reporting-owner.json`:

```json
{"schema":"IEMS_REPORTING_SYNTHETIC_V1","marker":"<ownedRun UUID>","databaseName":"portfolio_test_<32 hex>"}
```

The database must independently contain that exact `ownedRun` marker before
index initialization or any reporting writes. No application credentials,
production environment file, remote host, default source DB or automatic
target provisioning is supported. The runtime initializes only reporting
helper/source/consumer indexes after ownership checks and singleton acquisition.
Authority indexes/services remain with their existing owners.

Private CLI stdin is a JSON object with `uri`, `databaseName`, `root`, `marker`,
and current session `token`. Optional `python` is an absolute existing Python
executable with the existing analytics requirements installed. Do not put the
token in command arguments, logs, repository files or issue evidence. Feed this
object through the operator's private input channel to:

```text
node ops/demo/reporting-cli.mjs reconcile
node ops/demo/reporting-cli.mjs relay
node ops/demo/reporting-cli.mjs extract <persisted coverage run UUID>
```

The CLI is one bounded invocation, not an unattended daemon. Output contains
only counts/hashes/run IDs/status; failures print a generic private-run error.
It closes its runtime, raw subprocess and source client. The factory borrows
the injected source client and foundation. There is no app route, manifest or
SaaS registration change in this deliverable. CTO owns final app registration;
call the returned private methods only from an authenticated operator/job.

## Publication, replay and acknowledgement

Relay callers now **must** supply an explicit UUID tenant/plant/legal-entity
scope and current `authorize(event)` callback. Unknown scope fails before scan.
Only reportingSnapshotOutbox / reporting.snapshot.v2 /
iems.reporting.snapshots.v2 / reportingKafkaPublishedAt are used. Original
domain kafkaPublishedAt and Rabbit publishedAt remain untouched.

For each pending row the relay first follows its exact preceding revision and
then the child's actual order dependency, even if UUID sorting selects a child
first or a small batch excludes the parent. It publishes the latest existing
parent before the child and each aggregate in sequence. A missing predecessor,
parent, deleted parent, corrupt envelope or failed authorization leaves the
affected marker unset. A delivery budget bounds the invocation; dependency
chains over 1000 require an explicit bounded replay operation. Earlier valid
deliveries may already be committed when a later row fails. Retry uses the
same durable envelope/event ID/time. Lost markers can duplicate delivery.

New outbox rows and source receipts seal the full envelope hash in their
creation transaction. Replay rejects changed envelopes, including timestamp
changes, and unsealed older persisted evidence. This patch does not retrofit
hashes onto unknown historical rows or run a migration. Existing unsealed
projection evidence requires an explicit source-backed validation/rebuild
operation before this runtime can deliver it; source authority must be retained.

In LOCAL_FILE mode a send completes only after an immutable file mirror,
optional actual raw Parquet commit and transactional Mongo projection receipt,
head and effect have committed. Projection children require an active scoped
order. A raw/projection failure leaves the source marker unset. Raw files may
already exist after a later projection failure; replay verifies their identity.
File writes use synced temporary files and an exclusive hard link publication;
partial writes never replace a published immutable extraction. A crash may
leave unreferenced temporary/raw artifacts, which are not trusted publications.

When configured, reporting-raw.py calls the existing raw ingest/read APIs,
retains provenance and the checksummed manifest chain, and advances its pointer
only after the new manifest commits. Duplicate receipts must match their hash.
No duckdb availability means Parquet unavailable, not a successful raw service.
An omitted raw sink is explicitly `UNAVAILABLE_FILE_MIRROR_ONLY`.

Coverage extraction reauthorizes source resources, validates the persisted
manifest hash and all immutable sequence heads, includes bounded immutable
history and orders parents before children. Files and local coverage receipts
are written only after referenced snapshots/raw/projection effects succeed.
The supported source manifests remain **INCOMPLETE / trustedZero=false**. A
new source cohort or last scan page never proves whole-authority completeness.
The SQL complete-coverage gate is not bypassed or fed false COMPLETE data.

Kafka/SQL clients are **not configured by this local composition**; status is
NOT_RUN, and another runtime mode throws KAFKA_SQL_RUNTIME_UNAVAILABLE. Existing
Kafka consumer commits offsets after projection.consume succeeds. An actual
broker consumer still needs explicit source authorization, raw/SQL effect
binding, parent-gap retry/replay and lifecycle configuration before activation.
Cross-partition broker ordering is not consumer FK acceptance. Do not claim
Kafka, relational SQL, hosted/cloud or independent end-to-end acceptance from
these local files/Mongo effects.

## Single owner, shutdown and recovery

One `_id=snapshot-v2` owner in reportingRuntimeOwners guards the entire source
database, including different extraction roots. An exclusive local lock guards
the root. Each runtime serializes its own publisher/consumer/reconcile calls;
concurrent calls fail instead of creating a second loop. close is idempotent,
drains the active operation and releases its exact owner/lock. Factory failure
cleans only ownership acquired by that invocation. The CLI owns its client;
callers of the factory retain ownership of theirs.
If a configured sink cannot close or lock ownership changed, shutdown fails
closed with the owner retained for verified operator recovery.

A crash deliberately leaves the database owner and filesystem lock. No TTL,
automatic stale-PID cleanup or arbitrary cross-host exactly-once is claimed.
An authorized operator/CTO must first verify the recorded host/PID/run and all
child processes are stopped, compare ownerId in both records, preserve failure
evidence, then remove only those exact abandoned technical owner/lock records.
Restart from immutable outbox/source receipts with the original identities;
never delete source, mapping, consumer or coverage evidence to force a restart.
An ambiguous source transaction outcome requires reconciliation of its keys.

## Bounded verification

Run the focused synthetic fixture with the pinned cached Mongo binary and
runtime downloads disabled:

```text
node --test --test-concurrency=1 ops/demo/reporting-runtime.test.mjs
```

It checks actual generic source API data, authorization/revocation, immutable
coverage extraction, local projection/file delivery, lost-marker replay,
reversed UUID parent ordering, gaps, singleton, raw failure and cleanup. Prior
typed shipment and grouped cash/deposit/credit parity tests remain in
packages/domain-events/reporting-source.test.mjs. Full independent program QA
is deferred to TPR-150/152 after CTO TPR-149 integration.

## Typed customer-property return coexistence

The source adapter validates `REPAIR_RETURN_SHIPMENT_V1` /
`CUSTOMER_ASSET_RETURN` using the repair owner's current service-order,
return authority, quality, POD and warranty rechecks in the caller transaction.
It requires the actual immutable `repairKeys` return result and matching audit,
and authorizes each source resource, including `repair.read` on repair records.
The private CLI adds only this read permission and the named repair/delivery
source collections to its existing allowlist.

These shipments have no registered commercial reporting v2 target. They remain
visible in bounded shipment source counts/hashes and explicit unsupported entries
with real UUID, version, semantic hash, receipt and authority identities. Coverage
stays `INCOMPLETE` / `trustedZero=false`; no generic order, receipt, stock or money
is invented. Extraction revalidates these entries against current source authority
and denies revoked, deleted, held, missing or changed evidence. This is coexistence,
not repair financial analytics or whole-authority coverage.

Focused probe: `node --test --test-concurrency=1 ops/demo/reporting-repair.test.mjs`.
The linked reproduction remains the integration owner's unchanged
`node ops/demo/portfolio.mjs --synthetic-owned --smoke --output <new absolute directory>`.
