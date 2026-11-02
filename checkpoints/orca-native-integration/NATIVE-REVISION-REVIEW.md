# Native workflow revision correction

The sixth native probe at reviewed clean `366c477632701f87a6b78c8f436f5522b68d5c86` completed setup, owner creation and all authenticated webhook readiness checks. It then failed managed settlement: 12 tests, 1 pass, 11 fail, 0 skip, exit 1, 263779.2433 milliseconds. The parent is included in those totals. The pre-BEGIN source/revocation test passed. Several later failures depend on the first failed scenario and its unassigned `original`/`originalProof` variables; they are not separate root-cause findings.

The first causal failure was engine control/observe returning `409 EFFECT_OUTCOME_UNKNOWN`. Read-only diagnostics found successful actual n8n executions with the correct original request binding, payload hash, workflow ID and final result node. The strict provider reader rejected the workflow revision hash because n8n adds omitted node parameter defaults before execution. The actual execution snapshot therefore differed from the imported snapshot even though the submitted workflow had not been edited.

The retained run has 11 actual executions: six webhooks and five schedules, plus four local SMTP journal receipts. These prove producer activity only. Managed terminal settlement, ACK-loss recovery, publication fences after real send, exact barriers and privacy acceptance did not pass. No customer delivery is claimed. Original unknown attempts remain unknown; their bindings and native evidence were not rewritten or replayed.

The fix materializes defaults in newly generated native workflows **before** hashing and import. It uses the installed pinned n8n 1.121.3 node descriptors and the same `NodeHelpers.getNodeParameters` call made by n8n's `Workflow` constructor. The helper restricts node type/version pairs to the eight existing workflow types, rejects unknown/ambiguous schemas and checks the n8n version. The runtime's configured package root is passed explicitly. Historical snapshots and provider hash comparison remain untouched; simulation export generation is unchanged. No provider, adapter, app, registry, dependency, lockfile, deadline or resource guard changed.

Focused verification ran on final owned source changes atop `366c477`:

```text
IEMS_NATIVE_TEST_ROOT=<external owned synthetic-node-defaults directory>
node --test --test-concurrency=1 ops/automation-lab/native-probe-support.test.mjs ops/automation-lab/native-activation.test.mjs ops/automation-lab/readiness.test.mjs ops/automation-lab/workflow-contract.test.mjs ops/automation-lab/smtp-sink.test.mjs ops/automation-lab/transport-boundaries.test.mjs
```

Exit 0, 24 pass, 0 fail, 0 skip, 4422.5983 milliseconds. `node-defaults-focused.tap` SHA-256 `942a0a2b63caa92c5e6f8dacbe015cd3955b3308661b717d9a590912798276e3`. New tests verify defaults are stable across repeated normalization, unknown versions are rejected, changed executable parameters still change the hash, and all generated parameters match normalization through the actual installed runtime node classes for all eight types. Existing scoped credentials, webhook denial, SMTP, ownership and activation checks remain intact. Syntax and diff checks pass.

A separate read-only comparison matches prospective generated hashes to all six retained real webhook snapshots, covering the digest and SLA workflows. This is compatibility evidence, not a new execution or settlement of the old attempts. The old expected digest hash was `6a29a86f75f2ccaba19fe7c2ed1b321f431e832ce6ceda0de1c86d05e529ed04`; actual runtime and prospective generated hash are `32be488e7a40d37104594bb3863dcaf79160a960b84a3437c72e5b99c1393b89`.

`native-sixth.tap` SHA-256 `90b2364f840809971f1df3368df0883eee90ad8f5e50e69b3ca81fb9080af334`. Marker-checked database drop and cleanup completed; independent cleanup confirms all eight original process identities gone and all 20 reserved ports free, SHA-256 `d9077fcc2d33cf37ce1c445862bd81f5439808b626c57a0e23579425ca3a7891`. Raw logs, SQLite history, SMTP journal and diagnostic receipts remain in the private external checkpoint root. No owned service remains.

The earlier fifth probe failed CPU preflight before any service started. All failed resource samples and prior setup failures are retained. The sixth launch followed the coordinator's bounded stability window and three consecutive passing original resource samples, plus normal live preflight. No threshold or deadline was reduced.

New exact-SHA coordinator review is required before a fresh native probe. Product remains **UNACCEPTED**, `fullEndpointCoverage=false`; ErrorTrigger correlation, scheduled-child continuation, WA15/17, PREPARED document recovery and independent QA remain open. Passing focused tests and historical hash compatibility do not close the failed managed native scenario gate.
