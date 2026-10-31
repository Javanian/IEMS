# PLAT-038 v15–v17 implementation handoff

Allocated separate-effect protocol, engine/error/recovery, private CS phases, four AI route boundaries, five callers, v16 observation ports and v17 cleanup metadata authority are implemented. Status: IMPLEMENTED_QA_PENDING. This is an implementation handoff to TPR-149, followed by independent TPR-150/152 QA; whole PLAT-038 and program acceptance remain INCOMPLETE.

Required base `fb27134cafed7c335cb7856687383993bdc01912` was adopted once into the existing pilot branch, preserving `6adac5bf8601383f5d8bcc9820c1f31cbf954d91`, `147a7917d468854fca4d1b75988bd338c5172e9f`, reporting and E02 ancestry. No other worktree, root manifest, reporting algorithm, role grant or original receipt digest was changed. The complete per-feature SHA ledger and actual route/namespace/source inventory are in `PLAT-038-V15-COVERAGE.json`. Final handoff tip is recorded in the issue implementation-result and own checkpoint, avoiding a self-referential source pin.

## Protocol and original receipts

The four private orchestration collections are `saasEffectCommands`, `saasEffectAttempts`, `saasEffectEvents`, and `saasEffectBarriers`. Their exact unique identities and source classification are committed in the registries. They retain accepted intent, attempt/fence/epoch, observation and drain proof; they are not a second business ledger. Generic evidence excludes private message text, chunks, vectors and secrets. The separate marker-owned native provider database is disposed after tests and is never a tenant business archive.

| Boundary | Original authority and metering |
| --- | --- |
| Engine acceptance | Existing `automation_audit_logs` tenant/key and original payload digest; AUTOMATION_ENGINE_RUN original immutable 202 result. One accepted root charge. Actual human execute and real scoped service session revalidated. |
| Engine error | Existing correlated AUTOMATION_ENGINE_ERROR audit receipt; actual run/execution/service binding. Nonbillable observation, never a stop certificate. |
| Full recovery | Existing AUTOMATION_RECOVERY audit receipt freezes bounded delivery/draft selection. Existing parent intent observations are nonbillable; a genuinely new deterministic resolution intent owns its own receipt and one charge. Replay does not rescan. |
| CS local phases | Exact original `cs_idempotency`/outbox actionKey/content/binding/conversation/FIFO/mode authority. Private factory capability per parent/attempt/fence; no caller-made worker user or general enrolled exemption. |
| Index rebuild/cleanup | New explicitly allocated AI_INDEX_ROOT_V1 control identity tenant/plant/user/action/resource/key owns immutable acceptance and one charge. Final original `foundationCommandResults` ai.index filter/inputHash/response remains business publication authority; private root settlement never charges again. |
| Vendor dispatch/reconcile | Original approved `foundationCommandResults` ai.vendor.deliver intent plus exact existing `aiVendorDeliveryAttempts` identity/hash/source/approval/recipient/provider. Nonbillable phase; reconcile only observes that same attempt. |

Claims commit before invocation; ambiguous commit prevents provider work until same-key ownership reconciliation. Provider BEGIN reauthorizes current origin/source/epoch in a transaction; invocation runs outside it. Settlement validates actual factory/native receipt, exact attempt/fence and current publication authority. Duplicate/late/cross-scope callbacks cannot create another root or charge. Unknown ACK, timeout, lease expiry and process loss never authorize an automatic resend.

An existing human delivery review receipt can fence an attempt only before durable provider BEGIN. A new ordinal/fence binds the immutable review; already-begun UNKNOWN remains reconciliation-required. Publication denial retains actual provider observation separately, rolls back the full business publication transaction and does not imply recall. This includes an actual competing index CAS denial.

Stop closes the durable tenant epoch and adapter gates, drains actual asynchronous work and verifies instance/epoch/high-water/complete attempt sets and native terminal receipts. A restart cannot reuse an old instance's absent promises or barrier. Suspension denies new dispatch/publication; narrowly authorized observation can retain already-begun outcomes without billing or business publication. Managed history requires a verified barrier before lifecycle enrollment/export/archive; legacy/unmanaged history remains fail-closed.

## Controlled adapters and AI source authority

Only host-created LOCAL_SIMULATED capabilities and already-authorized synthetic loopback evidence are supported here. Engine, CS and vector/vendor fixtures perform real delayed asynchronous work, durable deduplication, native receipts, stop gates and fresh barrier verification. `LOCAL_HASH_FIXTURE_V1` is a synthetic model fixture, not evidence of production embedding quality or a paid model. No real engine, SMTP, vendor delivery, model, vector service or cloud was invoked.

Rebuild freezes source revision/hash/ACL/model/dimensions, generation and point IDs before EMBED/UPSERT. Original algorithms, publication CAS and committed-generation visibility remain. Orphans are inert until explicit exact-ID cleanup with actual native proof. Cleanup protects the current published points; a timeout cannot clear pointers or imply removed count. Original pointer result and native requested/deleted/remaining proof keep separate meanings.

V16 named snapshot ports use real opaque scope authorization before and after reads; they preserve exact source/recipient validators and perform no fence or other database writes. Effect ports retain their original fences. Status is neither publication authority nor stop proof.

V17 adds only named cleanup metadata/snapshot ports. They require current ai.index, actual per-user document ACL, scoped active actor/session/membership, canonical content and provenance. Issued sources additionally require current ai.vendor.source.read and the actual immutable approved revision/hash chain. The sole document-state exception permits active:false; a historical issued reference may have currentDocumentRevision greater than its original revision, never rollback or forged content. Metadata exposes no document text, chunks or financial lines.

New plans explicitly use CLEANUP_METADATA_V1 and a separately named cleanupMetadataHash; original canonicalSourceHash/contentHash/reference/inputHash meanings remain. Source/ACL/index model/dimensions/generation/point selection are rechecked at claim, provider BEGIN and publication. Old accepted plans retain their original sourceHash policy and plan/result bytes; no backfill, reselection or conversion. Explicit GET cleanup status and the Assistant cleanup form do not relax rebuild, retrieval or general status.

## Callers and local proof

Five assigned workspaces retain exact original caller key/body/scope across uncertain responses and expose explicit accepted intent status, continuation and observation. Only public intent references persist for phase recovery. Unknown work is observed, not automatically resent. Credential one-time no-recovery behavior remains intact; no secret was captured in screenshots, storage or evidence.

The focused commands, exit status/counts, failures and raw logs are in the issue evidence attachment. Tests use cached Mongo 7.0.14 with runtime download disabled, isolated marker-owned databases and guarded cleanup. Actual tests include source/actor revocation, scope isolation, quota/rollback, original replay, duplicate claims/callbacks, unknown commit, lost ACK, no resend, delayed stop/drain, restart/barrier rejection, root once/worker zero billing, inert orphan/exact cleanup and all-collection hash equality for read-only status. The legacy-plan fixture uses real current grants and the actual accepted-root API with the prior allocated plan schema; it does not fabricate a final business receipt or edit an existing control row.

Full independent security/browser/concurrency/conservation/accessibility/credential/privacy/regression/public CI is NOT_RUN here. Focused mounted browser and linked synthetic smoke remain bounded implementation evidence. Reporting stays INCOMPLETE/trustedZero=false; web HTML/authenticated proxy smoke is not a browser or production acceptance claim.

## Remaining boundaries and downstream action

No v15–v17 allocated local phase is closed merely by declaring it unsupported. The actual supported modes and all 406 routes are enumerated in the coverage file and admission registry, with fullEndpointCoverage:false.

- Historical PREPARED/partial renderer reconciliation remains a separately reserved local data-recovery contract. Existing source/artifact/receipt integrity and no-reseal gates remain; no automatic history conversion or erasure claim.
- Any unmanaged engine/vendor history or CS SENDING/UNKNOWN still needs authoritative historical receipt/observation/drain reconciliation. A fresh managed local intent or terminal text does not backfill that authority.
- Real engine/send/model/vector/cloud capability is EXTERNAL_DEPENDENCY and NOT_RUN: separate access/spend/send authorization and actual adapter lifecycle proof are required. PLAT-033/034/035/036 actual pilot/cloud/SLO evidence remains external; Databricks PLAT-039 remains PLANNED.
- TPR-149 adopts the complete usable tip sequentially, reviews actual source/metadata and produces the immutable final integration candidate for TPR-150/152. No public push, merge, deployment, user-data operation, spend or live send is authorized by this handoff.
