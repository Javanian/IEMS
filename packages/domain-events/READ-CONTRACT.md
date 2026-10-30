# Domain events to reporting

Source authority remains MongoDB domain state. Use foundation `commands.execute` for domain/result/audit/outbox atomicity; do not call a broker inside the domain transaction. This package consumes that durable outbox. KafkaJS-compatible injected producer must use idempotent production configuration, TLS/auth and `acks=-1`. A lost publish marker can duplicate an envelope. Partition by tenant/plant/aggregate. Invalid schema stops publication without deleting source evidence.

Envelope v1: eventId/schemaVersion/tenantId/plantId/aggregateId/aggregateVersion/type/occurredAt/payload. IDs are UUIDs; timestamps UTC; decimal values strings with explicit currency/UOM. Payloads are full resource snapshots for analytics, with `deleted: true` tombstones, `resourceType`, and resource-specific fields. Unknown schema/type must quarantine, never infer domain meaning. Multiple events for one aggregate revision need distinct stream aggregates; the sequential consumer rejects ambiguous same-version events. Domain owners must explicitly map their events before enabling consumers.

Consumer authorization callback is mandatory. Mongo projection receipt, version head and effect share one transaction/session. Apply callbacks perform only Mongo writes using that session. Kafka offsets advance after commit. Revoke/deactivate producer scopes through authorization callback. Version gaps block and require source replay; no silent skip. Event ID reuse with changed content fails. Keep receipts for the replay horizon; deleting receipts requires an approved full rebuild.

Downstream raw files are immutable versioned envelopes plus receipt/availability timestamps, checksums and cursor ranges. Publication requires reconciled manifests and successful quality gates. Reporting is read only, never a writable business ledger. No SAP posting, source mutation, production migrations or cloud acceptance are included.

Integration owner supplies Kafka client lifecycle, source type mapping, service authorization and foundation runtime wiring. No root manifest/router change is made here. Minimum syntax is separate from final independent broker/restart/reconciliation QA.
