# Operations implementation handoff (TPR-145)

PLAT-018, PLAT-030 and PLAT-032 are implementation deliverables. Independent acceptance belongs to TPR-150/152 after TPR-149 integrates the immutable candidate. See the issue's `implementation-result` document for exact commits and command receipts. No public push, deployment, legacy mutation, biometric enrollment or real-model/device acceptance is included.

## Shared integration delta: CTO TPR-149

Only CTO changes shared initialization, role policy registration and routing. This branch supplies complete modules/screens and bounded integration tests; it deliberately does not edit `app.mjs`, `PortfolioWorkspace.jsx`, manifests, lockfiles or shared reporting helpers.

1. Before creating tenant foundation, register exported `operationsRoles`, `voiceRoles`, `workforceRoles` using the existing role registration convention. Add the corresponding action arrays to the existing owner role if appropriate under the program policy. Registration defines capabilities; it does not assign new roles or credentials to users. Maintain the existing session/origin/JSON guards.
2. In initialization call `initializeOperations(db)`, `initializeVoice(db)`, `initializeWorkforce(db)`. These create indexes only for the modules' new technical collections. Do not run them against user databases without the existing migration gate.
3. Inside `createApp`, before the final catch-all/error middleware, call `installOperations(app,runtime,{id,fields,guard},options)`, `installVoice(app,runtime,{id,fields,guard},voiceOptions)` and `installWorkforce(app,runtime,{id,fields},workforceOptions)`. Install behind the existing authenticated `/api` middleware. The operations/voice modules share the existing transaction guard and operations idempotency receipts. Origin checks must stay outside all installers. Cross-origin player deployments need the explicit `X-Playback-Token` request header added to the existing exact-origin CORS allowlist; the same-origin portfolio proxy needs no new origin.
4. Mount named React exports `OperationsWorkspace`, `WorkforceWorkspace`, `VoiceWorkspace` in the shared portfolio shell, for example `operations`, `workforce`, `voice`. Keep navigation permission-aware. The owned browser harness renders these actual components without changing the shared router.
5. Configure the private adapters below. Missing sources remain `NO_DATA`; missing face verification or voice tooling fails closed. No real credential is committed here.

## PLAT-018 reads and telemetry

`GET /api/operations/dashboard` reads actual scoped sales orders, manufacturing work orders, shipments, invoices and receipts in one snapshot transaction. Each native source requires its domain read capability in addition to operations access. Unauthorized sources are explicit. Source pages are bounded to 100 records with count/coverage and drilldown cursors. Quantity totals cover observed rows only and group exact UOMs using decimal strings. Missing fields are incomplete, never fabricated zero.

Order invoice balances have one row per order, separate from quantity buckets. Exact monetary arithmetic uses the fulfillment currency helpers. Only immutable posting/settlement evidence can produce verified invoice balances; legacy/missing proofs remain incomplete. No invoice rows means no financial data, not zero paid or zero outstanding. This balance excludes unallocated deposits and unbilled order value; it is a read projection, not another ledger. Reconciled reporting manifests expose their actual as-of time, baseline, freshness and source watermarks, without promoting old coverage into current authority.

Production stage age uses the recorded planning/release/operation/QC timestamps. Other sources expose last-update age and missing stage timestamps explicitly. EWS warns about active observed records with no update for seven days; it is not a predictive model. `GET /drilldown/:source?after=UUID` provides actual records. `GET /capacity[/:equipmentId]?from=UTC&until=UTC` uses the maintenance owner's equipment holds/windows and revisions. It measures recorded availability in minutes, not throughput or labor certification. The heatmap retains numeric values and accessible meters.

`createLegacyReadAdapters({pool,authorize,resolveBindings,windowMs})` supplies concrete NFC, timesheet, HMI, SOW and SPC adapters. Integration supplies an already-configured PostgreSQL pool with read-only privileges and explicit tenant/plant-to-source bindings. `authorize(context)` reauthorizes source access; `resolveBindings(context)` returns only approved bindings `{resourceId:UUID,sourceKey,parameterId?,sourceUom?,uom?}`. No caller can select a table or SQL expression. A maximum of 20 bindings per kind are queried in a repeatable-read, READ ONLY transaction with a two-second statement timeout; extra bindings remain incomplete. No connection or legacy query was executed during this implementation run.

| Kind | Actual source / bound key | Measurement |
| --- | --- | --- |
| NFC | `public.usernfc.machineid` | Count of registered NFC identities for the mapped machine; no UID/name/employee row leaves PostgreSQL |
| TIMESHEET | `timesheet_transaction.workcentercode` | Sum of recorded duration hours for closed entries fully within the window |
| HMI | `mch_machine_ping_log.machineid` | Latest actual average ping latency in ms; absence stays unknown |
| SOW | `sow.workcenter` | Recorded planned hours for SOW rows updated in the window; not actual production hours |
| SPC | `processcontroldata` + item/parameter, mapped machine and parameter ID | Latest exact signed numeric sample; `sourceUom` must match the actual parameter and `uom` is its explicitly registered canonical unit |

Queries were derived from the existing legacy controllers/services in this prerequisite tree. The legacy snapshot fingerprint is an observation fingerprint, not an invented original event ID. PostgreSQL schema/connection/live source acceptance remains an external/runtime boundary. Separate observation and sample freshness prevents a fresh query from disguising an old HMI/SPC sample.

`installOperations` also accepts private `telemetryMappings[name] = {uom,authorize,readSample}`. The authorizer must fence current source revocation in the supplied Mongo session. `readSample` must resolve actual immutable source revision/value/UOM/timestamp/window, not echo the request. `POST /samples/:UUID/sample` compares all supplied fields against that evidence before the idempotency receipt. Corrections require a new source revision and preserve mapping, UOM, sample timestamp and window. Actor/result/audit/outbox/revision commit together. Only a whitelisted full numeric sample enters `operationsTelemetryOutbox`; no consent, biometric credential/template or private message field is accepted.

`relayOperationsTelemetry({db,producer,authorize})` is an optional single-owner publisher for `iems.operations.samples.v1`. It reauthorizes each registered source, requests `acks=-1`, and marks only its own outbox after success. Delivery can repeat if acknowledgment/marking is lost; consumers must deduplicate immutable event IDs. Original source revision, sample business correction revision and event ID are separate. CTO/data owner must explicitly register this sample transport/consumer. Financial `reporting.snapshot.v2` currently accepts only order/payment/fulfillment snapshots; telemetry is never forced into that schema. No broker/publication was run here.

## PLAT-030 verification

Private configuration: a stable secret `pepper` of at least 32 bytes, `devices[deviceId].authorize({scope,filter,session})`, and optional `assertionVerifier.verify(...)`. Pepper rotation requires managed credential replacement; it is never returned to clients. Subject membership, plant/entity access, actor authorization and consent/profile changes are fenced in the same effect transaction, including replay. A user changes only their own consent and fallback credentials. PIN is 8–12 digits and salted+scrypt derived behind the private pepper; opaque NFC credentials are HMAC hashed and unique within plant scope. Removing credentials invalidates outstanding challenges.

The face verifier validates an existing signed, live 1:1 assertion reference against the supplied subject, device, nonce and challenge ID. It must perform trusted local assertion validation, no external send, enrollment or template persistence. Its return contract is `{matched,live,subjectId,challengeId}`. No adapter means face verification is unavailable. Raw proof/PIN/NFC values never enter command receipts, public profiles, audit or outbox. Stored request hashes are keyed. Verification receipts are short-lived evidence for an authorized downstream workflow, not an attendance ledger or analytics feed.

Routes under `/api/workforce`: `GET /capabilities`, `GET /operators/:id`, and POST `configure`, `consent`, `challenge`, `verify` on that operator. Commands carry expected version and idempotency key. Consent purpose is `ATTENDANCE_VERIFICATION`, explicit, expiring and revocable. Kiosks select a claimed identity and one method; a 60-second nonce/device/profile-bound challenge is consumed exactly once. Five challenges per minute and five failed attempts trigger bounded limits/cooldown. A verifier error produces a private, consumed rejected receipt with a safe fallback reason. NFC and PIN do not require face consent. `workforceOutbox` is private operational evidence and must not be routed to analytics.

## PLAT-032 generation, publication and playback

`createVoiceFileStore` requires an owned artifact directory, real model/config files, pinned SHA256s and model ID, plus ffprobe. Missing/mismatched files fail closed. The existing native Piper helper is preserved; the new `generate_zone_announcement_mp3` validates pinned hashes before/after generation, measures monotonic native generation time, validates/merges via the inherited helper, and removes its owned temporary/failed output. No tone/fake model fallback is used.

`installVoice` receives that store, `workerAuthorize` and registered `players[id].authorize`. Those callbacks reauthorize and fence the configured worker/player's source/zone access in the supplied session. The service trusts this registered worker boundary; synthetic test stores are not runtime model evidence. Runtime configuration must use the real file store, not the test fixture.

The zone queue derives its text from an actual active work order/revision with seven days of recorded inactivity. It never accepts a free-form private message or a fabricated EWS event. Source revision is fenced again before publication and playback. Lifecycle: QUEUED → GENERATING → READY → explicit local PUBLISHED → exclusive PLAYING → PLAYED. Unstarted jobs can be CANCELLED. Expired generator leases recover to QUEUED only within three attempts, otherwise ERROR. Player failure/expiry returns to PUBLISHED within three attempts, otherwise ERROR; recovery never pretends the audio was played. Zone and job CAS plus receipt/audit/outbox writes are atomic.

`apps/tts-worker/zone_worker.py` defaults to one job; `--loop` is explicit. It requires private `IEMS_VOICE_API_BASE`, `IEMS_VOICE_ORIGIN`, `IEMS_VOICE_SESSION`, `IEMS_VOICE_ARTIFACT_DIR` and the existing Piper tool/model environment. The registered generation session is issued through the existing service/account policy; the worker does not create credentials. It makes no PostgreSQL/schema writes and never publishes playback. UUID artifacts have an exclusive owner lock, then a no-overwrite atomic hard-link publication. An uncertain `/generated` result preserves the owned artifact/lease for reconciliation. A crashed old lock/artifact is not automatically deleted; its owner verifies the lease/process before bounded cleanup.

Voice endpoints live under `/api/operations/voice`: zones list/detail/configure/enqueue/lease/started/played/failed/recover; generation queue; jobs claim/generated/publish/failed/recover/cancel; authenticated zone audio. Every mutation uses expectedVersion/idempotencyKey. Worker and player tokens are excluded from public reads. MP3 bytes are checked against the inspected artifact hash before streaming. Stream access requires the current registered player/actor/token/zone lease and current EWS source. Playback acknowledgment requires start plus elapsed artifact duration, with a 250ms tolerance.

The zone player uses abort/cleanup, disables itself on unmount, releases object URLs, suppresses duplicate actions, and retains the same command key for uncertain lease/start/end acknowledgments. It reports completion only after `ended`; autoplay failures require a visible user action. Disabling or navigating away pauses the browser and leaves an unconfirmed lease for owned expiry/recovery. Existing legacy player call sites remain compatible when no zone ID is supplied. Native generation ms, server generation turnaround and server-observed player-start ms are separate; none is an invented speaker or model benchmark.

## Minimum implementation checks and evidence limits

Run from repository root with the existing locked dependencies:

```text
node --check apps/portfolio-api/src/operations.mjs
node --check apps/portfolio-api/src/workforce.mjs
node --test ops/operations/metrics.test.mjs
node --test --test-concurrency=1 ops/operations/workforce.test.mjs
node --test --test-concurrency=1 ops/operations/voice.test.mjs
python ops/operations/test_zone_worker.py
npm --prefix apps/web run build
node ops/operations/browser-smoke.mjs Operations <evidence-directory>
node ops/operations/browser-smoke.mjs Workforce <evidence-directory>
node ops/operations/browser-smoke.mjs Voice <evidence-directory>
node ops/operations/player-smoke.mjs <evidence-directory>
```

Mongo tests own a randomized `portfolio_test_` replica/database and cleanup marker; never point them at a live database. Browser harnesses use the installed managed Playwright/Edge and close their Vite/browser resources. Screenshots are explicitly synthetic UI inspection. Player media methods and HTTP receipts are mocked; voice store tests use a labeled synthetic store. Native unit tests prove failure/cleanup behavior, not successful real-model generation. Legacy SQL tests prove binding/read-only/projection behavior with a fake connection, not live PostgreSQL compatibility. Final independent regression/security/concurrency/recovery/real API+DB browser/visual/accessibility acceptance remains NOT_RUN.

Design follows the accepted navy/blue/slate IEMS MASTER/UI-CONTRACT, bundled typography and shared fields/tables/states/record shell. ENERGY 1 / RHYTHM 2 / MOTION 1: dense source tables, separate financial rows, exposed capacity and consent controls; no decorative motion or fabricated product imagery. Table scroll regions contain wide data on mobile; the basic inspection checks document overflow and focus. The antislop delivery pass covers honest source states, working actions, typography, labels/focus and declared direction; it is not independent accessibility acceptance.
