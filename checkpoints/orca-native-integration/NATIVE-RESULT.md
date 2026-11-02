# Integration B native producer result

**PASS for the bounded local native integration probe. Product remains UNACCEPTED; `fullEndpointCoverage=false`.** Tested implementation: `24171d8469297d26777c926bbeb6bd41ad4e2492`, clean at runtime. The final handoff adds evidence only; its exact SHA is in the external immutable checkpoint.

The approved seventh fresh probe completed with exit 0, **12 pass, 0 fail, 0 skip**, including 11 scenario subtests and their parent, in 144712.1871 milliseconds. It used real owned n8n 1.121.3 execution history, the actual fsynced local SMTP journal, the managed API/provider processes and explicit reconciliation. Local SMTP means **ACCEPTED_LOCAL**, not customer delivery. Synthetic fixtures and old unknown attempts were not converted into native proof.

## Verified behavior

- API engine acceptance, managed child execution, actual SQLite execution ID, actual SMTP acceptance UUID and explicit reconciliation preserve original root/attempt/fence/epoch/input/provider/selection identity. Original command receipts remain unchanged; child continuation does not add a duplicate billable root.
- Actual webhook ACK loss survives n8n and API/provider restart without resending the original begun attempt. Recovery retains the original attempt, execution and SMTP receipt identities.
- Wrong scope/fence/selection and missing/contradictory diagnostic copies fail closed. The copies are read-only diagnostics, not manufactured native rows. Actual owned engine history deletion also prevents a new branded observation, while the previously retained private receipt remains unchanged.
- Read-only status and scoped negative reads preserve full database snapshot equality. Trusted Origin, original actors, child identity and explicit mode boundaries remain enforced.
- Service revocation and source changes before BEGIN prevent sends. After actual SMTP acceptance, late private proof does not authorize revoked or stale business publication. API crash recovery observes the original send without rerendering a new intent.
- Delayed/racing child recovery against stop/drain preserves exact original cancellation and crossing behavior. High-water, stop epoch, attempt set and receipt hashes are checked, including after API/provider restart.
- Payloads and private tokens are absent from all four orchestration collections under the tested privacy assertions.

The retained pre-prune snapshot has eight actual executions. The native prune test removes one, leaving seven execution rows; six actual SMTP acceptance UUIDs remain in the journal. The private assertion ledger records those identities. Original eight recovery child assertions and existing provider/adapter tests were preserved; earlier results remain separately qualified in the prior reports.

## Changes and diagnosis

This continuation started at clean `927398476684bd705800e1d92fc1f450ddb18b08`, with the prior implementation and failed attempts preserved. Three bounded corrections were committed:

1. `1b0c4354f3e83082abee25cc5713160bb952a725`: native-only bulk activation followed by explicit error-workflow deactivation, guarded by fresh database ownership, exact eight-workflow inventory/revisions, empty execution history, stopped engine and read-only final active-state verification. This replaces repeated CLI startup without skipping workflows or changing simulation activation.
2. `366c477632701f87a6b78c8f436f5522b68d5c86`: generate a 50-character native fixture owner password instead of an invalid 71-character value, retaining 32 random bytes. The pinned n8n schema allows at most 64 characters.
3. `24171d8469297d26777c926bbeb6bd41ad4e2492`: materialize pinned n8n node defaults before native workflow hashing/import. Actual runtime snapshots had added omitted defaults, causing strict revision mismatch. Provider comparison, historical snapshots and original UNKNOWN attempts remain untouched.

Each new source SHA received coordinator review before another actual native run. No provider/adapter/app source, registry pin, generator metadata, dependency, lockfile, timeout or resource threshold changed during this continuation. Final focused tests passed 24/24 on source identical to the tested implementation; the real native suite then passed 12/12. These counts are different suites and are not combined into an acceptance total.

## Execution receipts

```text
IEMS_NATIVE_REVIEWED_SHA=24171d8469297d26777c926bbeb6bd41ad4e2492
IEMS_NATIVE_EVIDENCE_ROOT=<assigned external private runs directory>
MONGOMS_RUNTIME_DOWNLOAD=false
node --test --test-concurrency=1 ops/automation-lab/native-history.test.mjs
```

Node 24.19.0; existing pinned n8n dependency cache read-only. API 120s, setup 300s, parent 180s and teardown 60s limits were retained. The seventh run followed three passing original CPU/RAM/disk samples, reserved-port/exclusivity checks, and the original live startup guard.

| Evidence | SHA-256 |
| --- | --- |
| `native-seventh.tap`, exit 0, 12/0/0 | `4cfdc8f674d3a5d4b4dfa4f995a24ad18a638a43ae933fedba70c2cf27380259` |
| Private assertion ledger | `e03f25e809eb3e40d3057d03e8f426d28c602dec7eab08650795332147c6a196` |
| Independent seventh cleanup | `6de3e8345779e2f1e4e33e7e02abb7b02d3437334e8341f09239bdc3d3c77c8d` |
| `node-defaults-focused.tap`, exit 0, 24/0/0 | `942a0a2b63caa92c5e6f8dacbe015cd3955b3308661b717d9a590912798276e3` |

Exact commands, environment qualifications, source hashes and failed-run receipts are in [native-final-verification.json](native-final-verification.json). Earlier first/second startup/resource failures remain in the prior handoff. Third: setup timeout. Fourth: invalid fixture owner password. Fifth: CPU guard before services. Sixth: actual runtime revision mismatch, 1 pass/11 fail including dependent failures. All logs, private roots and failed resource samples remain external; no failed attempt was discarded or reclassified as a pass.

## Cleanup and remaining gates

The seventh run completed marker-checked fixture database drop and normal owned teardown. Independent inspection verified **all 12 original process identities**, including restarted processes, gone and **all 20 reserved ports** free. Private SQLite history, pre-prune snapshot, SMTP journal, identity/creation/executable/command ledger and raw log hashes remain in the assigned external checkpoint root. No live owned runtime remains. Shared PostgreSQL, user databases, other agents' source and source migration archives were untouched. All commits are local; no push, PR, default-branch merge or deployment occurred. Remote/CI status is UNKNOWN.

This is producer integration evidence, pending independent coordinator/product acceptance. Native ErrorTrigger original-attempt correlation and automatic scheduled-child continuation remain explicit source/workflow gaps. WA15/17, PREPARED document-intent recovery, Automation Center/independent QA and other contract-review gaps remain open. Those are not waived by this successful probe. The next action belongs to the coordinator: review this source-bound result and cleanup, record acceptance only within its proven scope, and route the remaining gates to their owners.
