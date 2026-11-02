# Stage-A provider result

**IMPLEMENTED_NATIVE_INTEGRATION_PENDING. Product UNACCEPTED; fullEndpointCoverage remains false.** Implementation commit: `60f7efbde2061bf8eb290c2cb53cddebac2e258b`. This report/evidence-only follow-up does not change tested source. The final handoff SHA is recorded in the external native-provider checkpoint.

The provider and adapter implement privately branded native observation, durable BEGIN and one dispatch claim before loopback HTTP, original-attempt reconciliation across process epochs, exact native execution/workflow/input/SMTP receipt binding, transactional pre-BEGIN cancellation, and durable stop-epoch/high-water/attempt-set barriers. Ambiguous begun work stays UNKNOWN/PENDING. Handler return values, ACKs, timeout, missing promises and diagnostic fixtures cannot establish a native terminal result. Current source/revocation checks still govern business publication.

The API, data shapes, immutable native binding, pinned n8n schema, final result node, actual SMTP acceptance UUID and stage-B requirements are frozen in [NATIVE-CONTRACT.md](NATIVE-CONTRACT.md). The new native mode is explicitly composed only in an exact marker-owned database. It does not admit unused native kinds or reinterpret old simulated/legacy history. The existing simulated mode and preview tests retain their original assertions.

## Checkout and owned change

- Worktree: `D:/Project AI/GITHUB/IEMS-worktrees/iems-accept-fix-20261101-platform`.
- Branch: `program/iems-accept-fix-20261101-platform`.
- Starting clean HEAD: `04284b02571943266bf88e097d829d5325165d7c`.
- Local rollback branch: `codex/iems-platform-pre-native-20261102`, verified at that exact starting HEAD.
- Authorized clean ancestor fast-forward input: `34349add1ea022b6953aa00d11334f707de6367c`.
- New source/test files: native provider and adapter plus their two focused tests; native API composition test.
- Existing source: effects registration/native refresh/publication-conflict mappings; app effects composition only; admission contract metadata; the separately approved two-entry build-registry source list.
- Generated outputs: domain-registry and admission-registry through their maintained generators, without manual hash edits.
- Exact implementation file list: [owned-diff.txt](evidence/owned-diff.txt). This documentation follow-up adds PROVIDER-RESULT.md, verification.json and owned-diff.txt only.

No automation/lab/workflow/SMTP source, AI provider, PREPARED document code, dependency/lockfile, global config, source migration backup or historical report was changed. No push, PR, default-branch merge, deployment, external email/WA send, account/credential change or shared PostgreSQL access occurred. Remote/CI status was not queried.

## Verification and evidence

All commands ran in the worktree above, with `MONGOMS_RUNTIME_DOWNLOAD=false`. Exact commands, tree qualification, counts and raw log checksums are in [verification.json](evidence/verification.json).

| Check | Tested tree | Result |
| --- | --- | --- |
| New provider/adapter/composition and registry integrity | Clean `60f7efbde2061bf8eb290c2cb53cddebac2e258b` | Exit 0; 17 pass, 0 fail, 0 skip |
| Existing effects, engine, delivery, all eight recovery child assertions, domain-port, admission and registry checks, plus then-current new tests | `34349add` with owned implementation dirty, before final native JSON hashing/SMTP-ID tightening | Exit 0; 58 pass, 0 fail, 0 skip |
| Maintained registry generators repeated | Final source | Byte-identical generated output |
| Source mismatch negative control | Clean implementation commit, isolated copy | Both actual verifiers reject changed source; restored copy passes |
| Unknown/private fields, scope and archive collisions | Broader dirty-tree regression above | Existing domain-port assertions pass without changed expectations |
| Read-only installed n8n source/schema compatibility | Installed `1.121.3`, five historical workflow snapshots | Fractional node typeVersion supported; no native observation minted |
| Syntax/diff checks | Owned source | Pass |

The final narrow run covers post-BEGIN authority revocation, delayed work versus drain, one durable BEGIN/dispatch under racing claims, wrong scope/key/inputHash/workflow/instance/fence, forged/cloned observations, restart and missing evidence, exact stop epoch/high-water validation, and explicit composition. Pure parser tests exercise positive structural execution/SMTP cases and adversarial missing/duplicate/contradictory cases, but their outputs remain unbranded. No unit fixture creates trusted runtime history.

Two implementation findings were corrected before handoff: native workflow snapshots include final metadata beyond their initial projection; native node typeVersion values are fractional and cannot use the business command hash's integer-only JSON contract. Native-only canonical hashing now handles finite JSON numbers, with bounded depth/value count; original command and binding hashes are unchanged. SMTP terminal output also binds the actual acceptance UUID, not merely a message correlation.

Mongo shutdown printed `ECONNRESET` diagnostics in retained raw logs; test exits and cleanup hooks passed. No test assertions, setup/recovery/parent/teardown timeout budgets or source verifiers were weakened. Existing registry-integrity tests retain restored isolated source copies in temporary storage; those are not running services or private native history.

## Registry provenance

[registry-provenance.json](evidence/registry-provenance.json) contains exact before/after source hashes and generated-file hashes. Domain source schemas grow from 110 to 112; admission pins grow from 114 to 116. The 270 collection names/dispositions, 406 routes and admitted kind inventory are unchanged. Native reserved kinds are metadata only; `admittedKinds=[]` and fullEndpointCoverage=false. Source-pin changes are precisely effects plus the two new modules in domain metadata, and those three plus the app composition file in admission metadata.

The lead approved the two additional `build-registry.mjs` list entries in `lead/CONTRACT-DECISION.md`, answer `msg_24a9bd3309c0` to `msg_9b8eb6c29713`, reaffirmed by `msg_eeac2f5930c0`. Generator normalization, field checks and private collection classification remain intact.

## Owned resources and remaining work

Only fresh randomized marker-owned Mongo fixtures and local fixture directories were created. Each fixture performs marker-checked database drop, client close and normal replica stop; the native adapter fixture logs PID, port, spawn command, observed time and data directory. The final fixture marker/database and full lifecycle output remain in the external `committed-source.tap`. Fixture directories are removed after marker readback. Final process inspection found no mongod or task native-test/n8n runtime processes. No n8n engine or SMTP sink was started for stage A; dependency caches were read only.

External checkpoint/evidence root: `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/orca-iems-20261102/native-provider`. Its `LATEST.md` is atomically replaced and read back; immutable snapshots are in `history/`. Raw logs remain there, not in Git. One File.Replace/null-backup checkpoint update failed on this PowerShell runtime; its immutable history survived, and the checkpoint was corrected using same-directory atomic File.Move with readback. The log also preserves the worker's duplicate scope question after losing its first ask session metadata; the same narrow approval was applied, without broader scope.

Stage B must consume the clean handoff, implement native automation kinds and trusted workflow/service/SMTP wiring, then demonstrate actual managed n8n execution and SMTP acceptance, ACK loss and native restart recovery, delayed/racing children, revocation/source change after real send, exact quiescence, privacy and unchanged root usage. Native terminal settlement is intentionally not manufactured by stage-A fixtures. The fixed reader currently fails closed above 10,000 executions, 16 MiB serialized execution/workflow data or 16 MiB SMTP journal. NATIVE_RUNTIME ownership assumes trusted private filesystem/Mongo writers; the marker is not protection against a local administrator rewriting history.

Stage C reviews B's new source pins and generated metadata before native acceptance probes. Independent acceptance and PREPARED document recovery remain separate gates. Next action: coordinator reviews this result and NATIVE-CONTRACT.md, records the final clean SHA from LATEST.md, then dispatches Integration B against that exact tip.

Delivery checks: scope PASS (explicit owned paths); evidence PASS (synthetic/native distinction and exact SHA qualifications); verification PASS (17 clean-commit tests and retained broader results); publication state LOCAL_ONLY. No UI was changed, so visual/interaction design checks do not apply.
