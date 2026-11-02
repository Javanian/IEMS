# Native setup activation review

The third native probe at clean `927398476684bd705800e1d92fc1f450ddb18b08` passed resource guards and API readiness but exceeded the unchanged 300-second setup limit. API readiness took 61.261 seconds; the first n8n credential import took 213.424 seconds, the workflow import 5.140 seconds, and two workflow activations about 3.6 seconds each. The cause of the long first CLI launch remains unproven. Actual native scenario assertions remain **NOT_RUN**, product **UNACCEPTED**, `fullEndpointCoverage=false`.

This change replaces seven native per-ID activation CLI launches with two launches: `update:workflow --all --active=true`, then `update:workflow --id=wf-automation-error --active=false`. The installed pinned n8n 1.121.3 command dispatch and repository methods confirm the same active flags result for the exact imported inventory. Both methods update `active`; timestamps need not be identical and are not workflow revision hash inputs. The simulation activation loop remains unchanged.

The native supervisor rejects an existing SQLite database before setup. Before activation, the helper verifies the exact private filesystem owner and Mongo marker, database identity, stopped engine, zero execution rows, eight expected workflow IDs, immutable revision hashes and inactive imported state. Read-only SQLite snapshots after each CLI verify the full inventory and expected active flags; the error workflow must be inactive before engine startup. Unexpected workflows, changed revisions, pinned/static data, missing ownership, stop during marker inspection, and misleading successful CLI exit all fail closed. No runtime helper writes SQLite rows or produces execution/SMTP proof. Existing setup, API, parent, recovery, teardown and resource budgets remain intact.

Only `lab-runtime.mjs`, the adjacent `native-activation.mjs` helper and its test changed. App/provider/adapter sources, registries, dependencies and lockfiles are unchanged; these lab paths are not registry source pins. CLI timing is now logged. All changes are local, with exact-SHA coordinator review required before another actual native run.

Focused verification command, run on `9273984` plus these owned changes:

```text
IEMS_NATIVE_TEST_ROOT=<external owned synthetic-bulk-activation directory>
node --test --test-concurrency=1 ops/automation-lab/native-activation.test.mjs ops/automation-lab/native-probe-support.test.mjs ops/automation-lab/readiness.test.mjs ops/automation-lab/workflow-contract.test.mjs ops/automation-lab/smtp-sink.test.mjs ops/automation-lab/transport-boundaries.test.mjs
```

Result: exit 0, 21 pass, 0 fail, 0 skip. `bulk-activation-focused-final.tap` SHA-256 `52c5e427e188338a9c47668164fc8ab84ec3759972b3885c80a28053b331ff5e`. Earlier focused run omitted the required scratch environment: 15 pass, 1 fail, retained as `bulk-activation-focused.tap`, SHA-256 `9bea28d5426ae7be518908863db8c659098bf1153985e4785dbd7fc4eed8b2e0`. Subsequent tests include one additional stop-race assertion. Syntax and diff checks pass. Synthetic activation fixtures only mutate workflow configuration; no fixture creates native execution or SMTP proof. The existing original eight recovery assertions are unchanged.

Third native command: `node --test --test-concurrency=1 ops/automation-lab/native-history.test.mjs`, exit 1, 0 pass, 1 fail, 0 skip, 314854.5906 milliseconds including teardown. `native-third.tap` SHA-256 `6c61f0bc44490a2d5666ce1c121364ee7e04d2166bad39cc536030e0dd7ef792`. Marker-checked database drop and all eight recorded process exits were verified. Independent cleanup verified all 20 reserved ports free and zero native execution rows. Cleanup hashes: harness `8e349d13e62da31a209958fe3d45d645b617f7fb66a1c1cf2cfcd318605d6409`, independent `4a83dbba2226999182be73f1a5f6bfdee4d0bc15f102e895c7b33c6bc57131a2`. No owned services remain; previous failures and private roots are preserved outside Git.

Installed source read-only evidence: n8n `dist/commands/update/workflow.js` SHA-256 `aa2a48525cda2d2cecd527123aa3e6d76d7af5912b355076566f2d6aec99ba21`; `@n8n/db/dist/repositories/workflow.repository.js` SHA-256 `7936fb0fb4acfe8fcedad24157d510f63d2c88e18b233f2f2bfab84835c46088`. A focused test executes only the extracted repository active-state methods against synthetic rows, not the n8n runtime. Read-only inspection of the third-run database separately confirmed all eight imported workflow hashes match generated revisions.

Remaining gates include all actual managed native scenarios, ErrorTrigger correlation, scheduled-child continuation, WA15/17, PREPARED document recovery and independent product QA. A setup optimization and focused tests do not establish native execution success or customer delivery.
