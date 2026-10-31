# Point-in-time feature and pinned model serving boundary, PLAT-031

This module consumes an authorized analytics source port; it does not query application tables or the current-state reporting view. `createPointInTimeFeatureReader({ foundation, source, featureKeys, clock?, timeoutMs?, maxRows? })` exports `read(scope, { plantId, businessAsOf, knowledgeAsOf, featureSetId })`. The adapter authorizes `analytics.read`, bounds its source call to five seconds, rechecks access after the read, and accepts only an `ANALYTICS_PIT_V1` snapshot with the requested cutoffs and a source manifest id/hash.

Every row must contain exactly the configured numeric/boolean/null feature keys and one provenance record per key. `occurredAt` must be no later than `businessAsOf`; `availableAt` must be no later than `knowledgeAsOf`. Duplicate entities, incomplete coverage, missing lineage, malformed snapshots and temporal leakage fail closed. Incomplete coverage and unavailable sources return abstention without partial rows. Results are sorted deterministically and are not persisted. The cutoffs match `analytics/READ-CONTRACT.md`; this adapter does not claim freshness or completeness beyond the source manifest.

`createPinnedModelScorer({ modelPort, timeoutMs? })` accepts only an explicit integer model version and SHA-256 artifact digest. It checks the model's READY state and exact feature signature before one bounded prediction call; it rejects alias names, version/digest changes and malformed outputs. It never retries prediction, mutates a model alias, or performs rollback. An operator may select a prior immutable version in an approved deployment/configuration workflow; no such model or deployment target is configured here. The injected `modelPort` is an integration seam, not proof of an MLflow endpoint or real prediction.

## Limits and evidence

Unit tests use scoped source/model doubles and synthetic temporal rows. They verify authorization fencing, both temporal cutoffs, manifest provenance, deterministic row order, incomplete-coverage abstention, immutable model-version pinning and output validation. No training labels/dataset, MLflow service, model version, prediction, alias update, registry rollback, production endpoint, or paid provider was accessed or invented. A trained model and approved serving/rollback owner remain external integration inputs.
# Complete local model workflow and integration delta

`jobs/ai/train.mjs` trains a real deterministic train-only mean baseline from an
explicit `AI_SUPERVISED_PIT_V1` labelled dataset. It requires target name/unit,
feature signature and per-feature source/version/event/availability provenance.
Use `node jobs/ai/train.mjs <dataset.json> <new-artifact.json> <trainEnd-UTC> <validationEnd-UTC>`.
Output creation is exclusive; no existing artifact is overwritten. Future features,
labels at/before prediction time, duplicate observations and empty partitions fail.
Training uses only labels available by trainEnd. Validation labels must be available
by validationEnd. Rows crossing a label boundary are purged, never shuffled across
partitions. The artifact records split IDs/counts, actual validation/test MAE,
target unit, source manifest and input dataset digest. No operational dataset is
invented or bundled; tests use labelled synthetic fixtures only.

`createManifestFeatureSource({bytes,expectedHash})` accepts an operator-provisioned
immutable `AI_FEATURE_HISTORY_V1` export (8 MiB/10k rows max), not an HTTP upload.
It verifies the exact bytes digest, tenant/plant/legalEntity, declared complete
coverage and numeric/boolean/null feature signature. Each record has entityId,
sourceId/sourceVersion, occurredAt, availableAt and features. For a read, both
cutoffs filter records before selecting the highest sourceVersion per entity;
bounded truncation becomes INCOMPLETE. The export must be produced by an authorized
analytics extraction process with truthful complete coverage; the JSON declaration
alone is not independent proof of business completeness. No direct application DB
or current_resources historical fallback is used. Changed/revoked exports require
host reconfiguration; no user request can choose a path, scope or digest.

`createLocalBaselinePort({bytes,artifactDigest,name,version,runId})` verifies an
actual baseline artifact and serves its trained mean. `createMlflowPort` supports
an external MLflow registry and explicitly configured immutable serving bindings.
Registry and each serving host have separate credential arguments. Fixed TLS or
loopback origins, redirect refusal, bounded calls and response limits preserve
host boundaries. Registry versions must be READY, match exact digest/signature
tags and carry run/source-manifest lineage. The `/invocations` payload uses
dataframe_split; the configured serving gateway must attest model name/version/
artifact digest in `x-iems-model-name`, `x-iems-model-version`,
`x-iems-artifact-sha256` response headers. A plain MLflow server without this
gateway fails closed because its prediction response does not identify the model.
No mutable alias is followed and no MLflow registry alias is changed.

`createPredictionRuntime(runtime, {features,modelPort,featureKeys})` constructs the
durable plant-scoped workflow; create features with `createPointInTimeFeatureReader`
over the manifest source. `installPredictions(app,models)` mounts authenticated
GET `/api/ai/models`, POST `/api/ai/models/select` and POST `/api/ai/predictions`.
Register `modelRoles` and call initialize explicitly. Select uses
`{key,expectedRevision,model:{name,version,artifactDigest,featureKeys},reason,rollback}`.
It verifies registry lineage, CAS selection, immutable selection history and atomic
audit/result/outbox. Rollback explicitly restores the previous immutable model,
with a reason and the same authorization/CAS gates. Prediction uses the selected
version and both temporal cutoffs, rechecks access and selection after model await,
and returns source/model lineage. Missing adapters/source/model abstain with no
fabricated predictions. Estimates have no domain write side effects.

`ModelWorkspace` is the English operator screen for `/portfolio/ai/models`, with
configuration/lineage, version selection, explicit rollback and point-in-time
estimates. Saved selection commands are scoped to tenant/plant/user before POST;
ambiguous commands reconcile with the same key. Shared host/roles/navigation/init
belong to TPR-149. Actual MLflow/model service, authorized business dataset and
production acceptance remain EXTERNAL_DEPENDENCY. No service was enrolled or called.

API syntax was checked against the MLflow primary documentation via find-docs:
[Registry workflow](https://github.com/mlflow/mlflow/blob/master/docs/docs/classic-ml/model-registry/workflow.mdx),
[Serving protocol](https://github.com/mlflow/mlflow/blob/master/docs/docs/genai/serving/index.mdx).
Earlier boundary-only milestone notes below describe the preserved initial commit;
the code/API/UI above supersedes their unimplemented-workflow limitations.
