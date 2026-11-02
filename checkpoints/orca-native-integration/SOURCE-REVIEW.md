# Stage B source review handoff

Native execution is **NOT_RUN** at this handoff. Product remains **UNACCEPTED**, with `fullEndpointCoverage=false`. Exact source review must precede the native harness. Stage A input is `da4bb20c5d2fe0cbe476aeef92f25828bbeac24c`; its tested implementation is `60f7efbde2061bf8eb290c2cb53cddebac2e258b`.

Native engine and delivery kinds retain the original command, immutable source selection, attempt, fence, epoch, provider key and input hash. Invocation returns transient payload to the branded adapter after durable BEGIN. Publication requires actual native history; native delivery means `ACCEPTED_LOCAL`. Separate local recovery controls native children without granting native proof or resending a begun attempt. Existing simulated kinds remain separate.

The workflow generator embeds the real SMTP transport and stores the actual sink acceptance UUID in the final result node. Native webhook revisions exclude mutable schedule state and use `nativeN8nWorkflowHash`; schedules retain separate workflow IDs. SMTP DATA journals fsync before acceptance and reject conflicting duplicate correlation. The lab uses the existing read-only pinned dependency cache, separate API/provider process, original setup/resource limits, private ACL root, exact marker, reserved ports and owned cleanup.

## Source and metadata scope

Only the assigned automation, lab, workflow, SMTP, admission metadata and test paths changed, plus the expressly approved app composition, two delivery retry policy branches and readiness fixture extraction. Provider/adapter and build-registry source remain Stage A bytes. Both generated registries come from maintained generators, including the complete actual source-pin delta. No exemption, collection reclassification, lockfile or dependency change was made.

The coordinator identified the engine publication code mismatch during review preparation. Native engine plans now emit `ENGINE_RUN_SOURCE_CHANGED` from their original source gate; simulated plans retain `ENGINE_SOURCE_CHANGED`. A synthetic pre-BEGIN check and a real post-execution source-mutation probe cover this distinction.

## Verification before native launch

`verification.json` records exact commands, evidence hashes and qualifications. The focused suite passed 47 tests; the affected native/legacy-engine follow-up passed 16 tests; the final lab checks passed 6 and final actual registry mismatch test passed 1. These counts overlap and must not be added as distinct coverage. All eight original recovery child assertions remain. The earlier scratch-setting failure is retained separately; the owned scratch setting was supplied without weakening the guard. Syntax and diff checks passed; maintained registry generation was byte-identical on repetition.

The native harness is `ops/automation-lab/native-history.test.mjs`. It refuses a dirty tree or an `IEMS_NATIVE_REVIEWED_SHA` different from HEAD. Its environment variable records approval; it is not an independent authorization service. The coordinator must approve that exact commit before it is set.

Planned probes cover real API acceptance, actual n8n SQLite execution, SMTP acceptance UUID, explicit recovery, original identity, lost webhook ACK, engine and API/provider restart, process crash, source/revocation before and after crossing, delayed and active children versus stop, exact barrier contents, foreign scope and read-only database snapshots. Pruning uses the owned n8n service after preserving private original history. Contradictory-history negatives are explicitly diagnostic in-memory copies, never manufactured native runtime rows.

Billing assertions start before engine acceptance: one engine root, one distinct digest business intent created by that workflow, and one explicit recovery-selection root. Native child invocation and observation add zero roots or usage. This does not describe three distinct operations as one free operation.

## Open gates

All actual native probes and cleanup remain pending at this source handoff. Runtime failures must remain failures, and source corrections require a new exact-SHA review. The current native ErrorTrigger path does not yet prove original-attempt error callback correlation; scheduled recovery acceptance does not itself prove automatic managed child continuation. Those are explicit workflow gaps, not native terminal proof. WA15 retention/reset/authenticated export/privacy, WA17 inbound/UI/provider latency, mounted Automation Center QA, independent acceptance and other contract-review gaps remain open. PREPARED document recovery is a separate unmet gate, outside this source ownership.

No remote publication, global service change, shared PostgreSQL use, external message or customer delivery occurred.
