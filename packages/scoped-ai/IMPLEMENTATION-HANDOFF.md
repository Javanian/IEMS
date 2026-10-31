# TPR-147 scoped AI implementation handoff

All six assigned IDs are IMPLEMENTED_QA_PENDING within the local supported scope.
This closes implementation, not independent acceptance or production readiness.
Workspace: `D:/Project AI/GITHUB/IEMS-worktrees/iems-all-20261030-ai`.
Branch: `program/iems-all-20261030-ai`. Local only; remote/CI UNKNOWN.
The preserved candidate was `24a597df874e6a83952ee1c1ae441dfe93b51d42`.
Final executable candidate: `66c0e7fa08d324095cec0534a0687851c320800c`.
The subsequent documentation commit changes only this handoff.

| ID | Implemented supported behavior | Boundary / downstream work |
| --- | --- | --- |
| PLAT-027 | Manual text and approved LEGACY/CATALOG PO extraction; per-user ACL, source/revision/hash fences; citations; publish/replace/revoke operator controls | No PDF/OCR/URL import. Source-bound retrieval also requires dedicated procurement authority. Independent evaluation pending. |
| PLAT-028 | Binding-authorized live order reads and persisted service metrics, separate document evidence, freshness/fixture/incomplete abstention; AssistantWorkspace | Uses predecessor customerService ports, not direct source queries. Shared app mounting and independent browser acceptance pending. |
| PLAT-029 | Durable immutable draft/preview/human approval/revoke; actual portal grant recipient; stable delivery intent/CAS lease/UNKNOWN reconciliation; VendorDraftWorkspace | All external sends disabled. Only explicit LOCAL_SIMULATED transport accepted. Email/WA contact resolver unavailable. |
| PLAT-031 | Both-cutoff manifest features; real train-only mean baseline tool; chronological split/leakage checks; artifact/run/dataset lineage; pinned local/MLflow ports; durable selection/rollback, predictions API and ModelWorkspace | Authorized business dataset, trained operational model and deployed MLflow service/gateway remain EXTERNAL_DEPENDENCY. No invented production predictions. |
| PLAT-044 | Scoped versioned Qdrant adapter; source/ACL/model/generation/point checks; status/rebuild/revoke; bounded tracked retired-point cleanup and recovery controls | Real Mongo/Qdrant proof pending. Unknown pre-publication orphan points remain inert; no arbitrary collection deletion. |
| PLAT-055 | Bounded current-request intent/FAQ/complaint triage; cited proposal, post-model source recheck, deterministic failure fallback; HTTP and AssistantWorkspace triage | No personal history, automated reply or selected language model. Real model/WA20 evaluation remains final QA/external configured input. |

## Commit ledger and provenance

Accepted base `0ad4248af46adad2762763438efb27aaace932b4`.
Previously incorporated prerequisite TPR-144 `c8f1fcfe153598ae3ac7436ed2f5718918c50b43`
without conflict; TPR-146 data `32c78a979881063f0f939e6efb4a529438944fcc` is an ancestor.
No duplicate cherry-pick, integration branch write or prerequisite replay this run.

| ID | Local commits (oldest to newest) |
| --- | --- |
| PLAT-044 | `bf8c9af0a17648d67b49dededc61440bf348f258`, `79d26a514fa56b4745fa864a1242efe4edee6985`, `d52a868f7fc3e8923882fe78dfa674761e1249dc` |
| PLAT-027 | `dc429394aef2bc3af6fe625be056b9cd3de39044`, `de1534eeaf9cf0f1617dde3f9e491d71438db763` |
| PLAT-028 | `a1c007ad020f2f345f8778ce7907c77282dbba50` |
| PLAT-029 | `0cbe32753fbdae058a58d6bb86f9bafa86c64d25`, `81ebc15ad722e2d7a4aae31b23abd1b2d236dfec`, `66c0e7fa08d324095cec0534a0687851c320800c` |
| PLAT-031 | `24a597df874e6a83952ee1c1ae441dfe93b51d42`, `df7e8be9bece71d58d7b72ab5ac2f56c688a71c1` |
| PLAT-055 | `ef3a1ef6169c134108e15894247be6b63c504192`, `d079b4ed864b6415bc79777f05b4e60265f179e3` |

Integrate branch ancestry once; do not cherry-pick this stacked ledger a second time.

## Exact owned file set

All deliverable files are new relative to the prerequisite tree. Enumerate with:

```powershell
git diff --name-only c8f1fcfe153598ae3ac7436ed2f5718918c50b43 HEAD -- packages/scoped-ai jobs/ai ops/ai apps/portfolio-api/src/rag.mjs apps/portfolio-api/src/assistants.mjs apps/portfolio-api/src/vendor-drafts.mjs apps/portfolio-api/src/cs-intent.mjs apps/portfolio-api/src/predictions.mjs apps/web/src/features/portfolio/AssistantWorkspace.jsx apps/web/src/features/portfolio/VendorDraftWorkspace.jsx apps/web/src/features/portfolio/ModelWorkspace.jsx
```

- packages/scoped-ai: indexing.mjs, indexing.test.mjs, qdrant.mjs, qdrant.test.mjs,
  documents.mjs, documents.test.mjs, issued-documents.mjs, issued-documents.test.mjs,
  rag-api.test.mjs, assistants.mjs, assistants.test.mjs, intents.mjs, intents.test.mjs,
  temporal.mjs, temporal.test.mjs, models.mjs, models.test.mjs, mlflow.mjs,
  feature-manifest.mjs, local-model.mjs, model-training.test.mjs, vendor-drafts.mjs,
  vendor-drafts.test.mjs, vendor-source.mjs, vendor-source.test.mjs, vendor-api.test.mjs,
  INDEX-CONTRACT.md, INGESTION-CONTRACT.md, ASSISTANT-CONTRACT.md, INTENT-CONTRACT.md,
  MLFLOW-CONTRACT.md, VENDOR-DRAFT-CONTRACT.md, IMPLEMENTATION-HANDOFF.md.
- jobs/ai/train.mjs; ops/ai/OPERATIONS.md.
- apps/portfolio-api/src/{rag,assistants,vendor-drafts,cs-intent,predictions}.mjs.
- apps/web/src/features/portfolio/{AssistantWorkspace,VendorDraftWorkspace,ModelWorkspace}.jsx.

No shared app/role/router/manifest, package/lockfile, predecessor source, schema
migration or other workspace was edited. Only own ignored Markdown was force-added.

## Checks actually run

Cwd was the assigned workspace. Tests used synthetic data, transaction/source/model
doubles and the real foundation executor; they are not independent full QA.

- PASS: all `packages/scoped-ai/*.test.mjs` via Node test runner at `81ebc15`:
  80 tests, 0 failed, 0 skipped, exit0. Covers scope/ACL/revocation, malformed input,
  source/model changes, temporal leakage, rollback, immutable workflow, atomic
  rollback, ambiguous delivery, correlated receipts and exact-point cleanup replay.
- PASS exit0: `node --check` every production .mjs in packages/scoped-ai, all five
  owned API modules and jobs/ai/train.mjs at `81ebc15`.
- PASS exit0: esbuild transform of all three new JSX exports at `81ebc15`;
  VendorDraftWorkspace recompiled at `66c0e7f` after command serialization/recovery UI.
- PASS exit0: `npm --prefix apps/web ci --no-audit --no-fund`; locked install only,
  no package/lock change. `npm --prefix apps/web run build` at `81ebc15` exit0:
  3274 modules, PWA output generated; existing large-chunk/Browserslist warnings.
  New UI exports await shared mounting, so separate JSX transforms cover them.
- PASS: final diff/staged whitespace and owned file review. No runtime artifact or
  secret added. Earlier doc trailing-blank check failure was fixed before handoff.
- NOT_RUN: actual Mongo transactions/index initialization/restart/concurrency,
  Qdrant service, mounted authenticated HTTP, browser/visual/accessibility at all
  sizes, actual authorized embedding/LLM/MLflow, complete regression/stress/security
  and independent retrieval/model evaluation. These remain TPR-150/152 after integration.

Run `8ad66b20-d91b-4bef-93a4-ac6289d8287d` metadata was queried; model/modelId were
null. Actual requested runtime model cannot be independently verified from that API.
No model identity is inferred from agent names or adapter configuration.

## Integration owner next action

CTO TPR-149 should incorporate this branch, register explicit ragRoles,
vendorDraftRoles and modelRoles, initialize workflow indexes in its isolated runtime,
and mount the five installers behind authenticated scope and origin/CSRF protections.
Propagate the host's trusted automationService identity flag; machine approval is
rejected at the vendor approval endpoint. Never assign the human approver grant
to service identities. Provider/model hosts and credentials remain explicit per
adapter; missing configuration stays unavailable/abstaining. No DB initialization
or provider enrollment was performed by this delivery.

Mount the three named UI exports under the existing portfolio shell. Pass initialized
rag to assistant/intent, existing customerService to assistant, and optional verified
feature/model ports to predictions. Do not turn on a live vendor transport.
Contracts contain exact routes/bodies; ops/ai/OPERATIONS.md contains lifecycle/recovery.
After TPR-149 integration, TPR-150/152 obtain the immutable integrated SHA for final QA.

Checkpoint: `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-147/6e70f0a8-d639-44c1-92db-0b23cdc10ab0/LATEST.md`.
Historical recovery evidence remains in Paperclip implementation-result and immutable
checkpoint history. No services remain running. No external message, live send,
production data operation, public push/merge/deploy or paid enrollment occurred.
