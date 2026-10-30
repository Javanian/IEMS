# PLAT-043 durable jobs

MongoDB `jobs` is the sole job authority, alongside foundation transactional audit/outbox.
RabbitMQ carries scoped identifiers only. Install with `initializePlatformRuntime` and
`installPlatform`; the shared app registration delta is in `ops/platform/INTEGRATION.md`.
No automatic registration or arbitrary client-selected handler code.

Enqueue requires a Mongo transaction. `platform.job.requested` outbox rows are created
atomically with the job. A bounded dispatcher scans due jobs and confirms Rabbit publish
before updating dispatch/outbox markers. Mongo due state recovers publication gaps and
broker data loss, including jobs whose outbox is already marked published. Multiple
dispatchers may send duplicates; only one Mongo attempt can own the job.

Worker uses manual ack, bounded prefetch, lease/token/revision fencing and fresh stored
session authorization inside the effect transaction. Handlers receive `{job,grant,session,db}`,
must use that session for every write, return canonical JSON, and perform **no network or
filesystem effects**. Transaction retries may invoke a handler again. External delivery
requires a domain outbox and recipient-specific idempotency/fencing adapter. Expired or
revoked requesting sessions fail closed; the UI shows the safe terminal diagnostic.

An attempt cannot commit after lease expiry or takeover. Successful handler writes, result,
audit and completion outbox commit together. Retry deadlines live in Mongo, never Redis.
Exhausted/denied work is durable DEAD state and publishes a confirmed DLQ identifier.
DLQ can contain duplicates and must never trigger automatic replay. Unknown commit outcomes
close the consumer channel without ack; redelivery reconciles authoritative job state.
Malformed messages are rejected to broker DLQ. Active duplicate deliveries are acked because
the due scanner recovers expired attempts. Run dispatcher continuously alongside consumer.

Requires Mongo replica transactions, RabbitMQ quorum queues, amqplib 0.10.9 injected by the
owned launcher. Use distinct namespace per environment. Topology uses durable quorum queues,
publisher confirms, persistent mandatory messages, DLX and bounded delivery limit. No job TTL
or destructive retention. Job inputs/results <=64KiB; envelopes <=4KiB. Handler code must
bound its own database work within the configured lease (default 30s).

Checks are focused implementation evidence. Broker restart/HA/concurrency and independent
security acceptance belong to final integrated QA; do not infer exactly-once external effects.
