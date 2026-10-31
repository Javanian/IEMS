# TPR-158 contract reconciliation

Local remediation evidence only. Integration belongs to TPR-151; independent acceptance belongs to TPR-152. Actual serving model UNVERIFIED; remote/CI UNKNOWN. Original QA-150 reports and failures remain unchanged.

## QA-001: exact replay and enrollment fencing

`admission.mjs` writes `tenants.saasEnrollmentFence` inside the caller transaction before looking up enrollment. This serializes an unenrolled command against concurrent subscription. It is authorization fencing, including before enrollment; it is not a usage, domain, outbox or rate charge. Removing it would reopen the enrollment race.

For an internal execution reservation using company output, `internal-execution.mjs` calls the main guard, the company-stock guard and the receipt hook. Both guards call admission authorization. An acknowledged replay therefore commits exactly three enrollment increments and two CRM authorization increments. It still verifies current company source and current grants before returning its original receipt. `applyMeter` returns an existing receipt before changing usage, revision, audit or outbox.

The former readiness assertion modeled only `crmFence`. Its replacement preserves full database equality, adding only the exact actor tenant's enrollment increment. No field is removed from either snapshot. The helper rejects unspecified enrollment deltas. The native `enrollment-fence.test.mjs` uses actual HTTP and marker-owned Mongo transactions, observes the real admission calls and shared active session, and checks two repeated replays. After enrollment it also checks exactly four foundation authorization increments on the six actor authority rows and three subscription admission increments. The original pre-enrollment receipt still charges zero. Payload conflict, missing company grant and inactive tenant must preserve the complete database snapshot, including authorization, quota and rate data.

The maintained readiness test retains the actual 99/100/101 reservation and 499/500 event histories, physical-stock assertions, denied-command rollback and historical trace checks. No business expectation is replaced.

## Residual QA-005

| Old expectation or fixture | Current contract and stronger checks |
| --- | --- |
| Admission and repair replay tests expected 400 routes | Final predecessor registers 406. Keep exact count, compare all registered methods/paths against the registry, and prove empty and extra-route hosts are rejected. `fullEndpointCoverage` remains false. |
| Unconfigured automation recovery expected 403 | Managed recovery requires an adapter with proven support. The current boundary returns 503 `EFFECT_ADAPTER_UNPROVEN`; assert the exact error, unchanged usage/business graph, no send, and retained uncertain delivery state. Configured managed recovery positives and adversarial cases remain in the existing v15 suite. |
| Lifecycle unit mock only offered transactional authorization and findOne | Status intentionally uses read authorization; quiescence reads a bounded history cursor. Implement both mock interfaces against actual mock state, preserving all old assertions. Add read-only state equality and unmanaged engine/vendor/SENDING/UNKNOWN export denial with full rollback. These unit tests are not native acceptance. |
| Receipt wrapper snapshot excluded authority and subscription rows | Retain the existing business, once-only meter and receipt assertions; additionally compare all collections without exclusions after quota denial, receipt insertion abort and revoked replay. |
| Repair/POD receipt test expected the first HTTP view to omit `salesOrderId` | Predecessor `ce0f08a`/`cc9e6d8` made customer-asset returns explicitly null. Assert own property plus null in both initial HTTP and persisted receipt, then compare the whole result directly; remove the fixture assignment that used to substitute the Mongo result. |
| Historical document repair expected a persisted PREPARED intermediate | Predecessor commit `6767c4c` already reconciled this: source/artifact/receipt/publication roll back together, authorized concurrent retries publish once, and historical PREPARED remains private and cannot be resealed. Preserve and rerun those API and lifecycle tests. |

Private customer principals remain factory-issued opaque capabilities. Existing native lifecycle tests cover forged/cross-binding authority, revocation, nested receipts, lost acknowledgements and current enrollment; no principal/grant guard is changed here. Existing unmanaged engine/vendor, PREPARED, SENDING and UNKNOWN gates remain mandatory.

## Final source pins

Exact predecessor `f03ea7b94f3d912aac704a89af5b087df1779de7` was imported with fast-forward from `589f4ed47d3cb141b4c85397cc685349c337cb38`, without conflicts. Candidate `96b8bea912a52b6c9ead1f03e698666edf64df0e` remains an ancestor.

Both committed generators reproduce the imported registries byte-for-byte in two runs. There is no new generated delta from test-only remediation. Independent review of all three TPR-157 metadata ledger entries verifies old/new hashes against their actual source commits and proves every other registry field, route, collection and schema unchanged. Final customer-service source hash is `c8e9c98cfec9ed2b08605951ca51476bab150fb55aa3ab70c70f2ed7ce72d4e1`.

`registry-integrity.test.mjs` invokes both actual source verifiers, copies their source corpus into run-owned scratch, changes one copied source, asserts both exact 503 mismatch errors, restores the bytes and verifies again. The workspace source and guard logic are never modified by this negative control.

Final commands, SHAs, actual pass/fail/skip counts, cleanup and any residual owners are recorded in the issue implementation result and durable checkpoint under `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-158/95296377-c20c-45c1-9119-06b2089fea8e/`. A passing local suite does not prove external provider, cloud, production or independent product acceptance.
