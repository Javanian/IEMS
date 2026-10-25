# Ownership

All new source belongs to `feat/company-stock-trace` in a separate worktree. Fourteen earlier worktrees have before snapshots of HEAD, status and tracked diff hash. Original dated planning documents and historical raw evidence remain protected.

| Owner | Scope |
| --- | --- |
| A domain | Company trace reader, company-stock route/index registration, owner tests and owner fixture |
| B frontend | Company trace UI/helpers, behavior tests, native browser helper and browser runner integration |
| C independent QA | Checkpoint QA fixtures, adversarial actual HTTP proof and independent report |
| Lead | Contract review, integration, CI/source audit, checkpoint documentation, acceptance and publication |

Only one owner may run local heavy work: installs, builds, owned Mongo tests or browsers. A run requires an explicit token and at least 2 GiB free memory with no existing mongod. Other agents can write their owned files and run pure checks. No unrelated process is stopped. The six package installations are actual locked installs in the new worktree, without dependency junctions.

The independent fixture and owner fixture are separate. A browser may reuse the independent HTTP fixture; that reuse must be disclosed rather than counted as a third independently authored fixture. Agents do not commit or push. The lead reviews changes, runs the integration gates and publishes only after local acceptance.
