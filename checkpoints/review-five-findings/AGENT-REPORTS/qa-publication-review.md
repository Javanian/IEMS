# Independent publication preflight

Read-only review of the integration working tree at HEAD `54a7e6db5fb1cfc48252477ca872d700c8c650ee`, before final staging/source freeze. Only this report was written by this review. No staging, manifest generation, package installation, build, Mongo run, Git mutation or `audit-publication.py --write` was performed. Active UI/harness changes mean this is an intermediate source snapshot, not a final publication certificate.

## Findings and disposition

1. **Required evidence environment missing from CI/reproduction: corrected by lead.** The independent picker asserts `IEMS_QA_EVIDENCE` before creating its fixture (`qa/picker-search-authority.test.mjs:15`). The original workflow independent-review step and README six-probe command did not set it, which would fail a clean run. The current workflow now supplies `${{ runner.temp }}/iems-independent-evidence` at `.github/workflows/portfolio-vat.yml:104`; README sets a portable temp directory before the command. This fix was verified by reading the changed source, not by running CI.
2. **Node version statement too broad: corrected by lead.** The original README said Node24 or later, while tenant-foundation, customer-service and wa-demo-bridge declare `>=24 <25`. README now states Node24.x, matching CI's version24. No Node25 compatibility is claimed.
3. **Side-effect import blind spot in audit regex: corrected by lead.** The original regex did not inspect `import './file.css'` or other literal side-effect imports. The current regex includes that form. Computed imports and package-manager dependency resolution still require separate checks; see below.
4. **Final source manifest and published-source gate: lead-owned.** `SOURCE-MANIFEST.json` did not exist at the initial review snapshot. After the lead generated/staged its candidate, an independent read-only audit passed321 manifest files and541 relative import edges with zero errors, exit0. This report's subsequent update requires the lead's final manifest regeneration/restaging. No clean implementation checkout, pushed SHA or final-head CI result is inferred from that local audit.
5. **WorkQueue source encoding: corrected by UI owner.** A later lead check found an invalid single-byte Latin1 middle dot in WorkQueue JSX. After the owner's correction, an independent strict UTF8 decode of `apps/web/src/features/portfolio/WorkQueueWorkspace.jsx` passed. This is an encoding disposition only; browser/build acceptance still belongs to the actual subsequent frozen source run.
6. **Unchanged quoting-test path classified as fixture, not local dependency.** Lead's initial publication audit attempt rejected `packages/document-rendering/test/wave3b-recovery.test.mjs` because a literal Windows path matched the local-dependency regex. Independent inspection confirms lines18-28 use `String.raw` Windows paths only as inputs/expected values of the pure workerPath command-line parser. Those strings do not reach filesystem access, process execution or imports. The later real-worker test uses its actual repository-relative script path separately. The unchanged file matches HEAD and normalized-LF SHA256 `f96a744b187d6d7488e73e0fa23fea8ef08f8b038bd959d2e5301f57dcff753b`.

The lead added exactly one filename-plus-normalized-hash exception to the local-path regex classification only. Independent checks confirmed another filename or changed non-newline content cannot receive it; ordinary manifest/hash and relative-import checks still run before that exception. CRLF/LF normalization follows the audit's existing hash convention. No renderer source was edited. The current staged candidate's actual read-only audit passed321files/541edges/0errors; the original failed classification remains recorded here rather than silently removed. This is a bounded false-positive disposition, not a directory-wide allowlist, dependency exemption or security certification.

No other concrete source-publication blocker was found in the inspected snapshot. This conclusion does not close the pending final gates or certify security.

## Inspected scope and static results

A read-only Git candidate inventory combined changed tracked paths with `git ls-files --others --exclude-standard`, limited to this integration checkout. The captured inventory contained63 modified tracked files plus57 proposed untracked files,120 total before this report. It included API/UI/test changes, the workflow, ignore rules and new checkpoint source. Later UI edits can change those counts; the lead must regenerate the final inventory after freeze.

The expanded literal-import inspection checked346 relative edges from those changed/new source files, including side-effect imports and literal dynamic import/require. It found no missing relative source target and no proposed source target absent from tracked-plus-proposed Git inventory. Nine edges intentionally target installed dependency assets under node_modules; these are not supposed to be committed:

| Installed assets | Supplied by documented locked install |
| --- | --- |
| mongodb-memory-server and mongodb used by owned demo/browser | apps/portfolio-api |
| Vite used by the owned demo | apps/web |
| pdfjs-dist legacy PDF reader used by browser verification | packages/document-rendering |

Those dependency paths exist locally and correspond to declared dependencies/devDependencies. Their existence after a clean `npm ci` must still be demonstrated on the final published source. This review did not mistake ignored node_modules for unpublished business source.

The candidate scan found no raw TAP/log/image/PDF/database/archive/key-file candidate, no matched absolute workstation path and no secret-pattern candidate. Patterns covered private-key headers, common AWS/GitHub access-token formats, credential-bearing database URLs and literal password/secret/token assignments. No matching value was printed. This is a bounded textual scan, not entropy scanning, credential validation, history scanning or a security certification. Ignored files and prior unchanged repository history were outside this source-change review. Temporary demo passwords are generated at runtime and are not a committed secret.

`git diff --check HEAD` exited0; Git emitted line-ending conversion notices for several working-copy JSX files. Those notices are retained as observations, not whitespace failures. New untracked files still need inclusion in the final staged check.

## Install, CI and audit closure boundaries

README and `.github/workflows/portfolio-vat.yml` agree on six locked installs: tenant-foundation, customer-service, document-rendering, portfolio-api, wa-demo-bridge and web. CI uses Node24 and Python3.11, checks the publication manifest, runs renderer/API/frontend checks and the independent probes, builds web and runs the configured connected browser. `IEMS_QA_EVIDENCE` is now supplied for independent picker output. Both README and CI include all18 browser flags with diagnostic-only mode disabled. This is source configuration consistency; it is not execution proof.

At the initial review snapshot, the audit scopes included the API, portfolio UI/tests, bridge, foundation/customer-service/renderer, domain fixtures and current QA scripts, plus explicit web config/lockfile/workflow/ignore files. Current checkpoint top-level reports/contracts were initially outside the hash scope. The lead subsequently expanded it to the entire `checkpoints/review-five-findings/` directory, including this report and contracts, while explicitly excluding `SOURCE-MANIFEST.json` itself to avoid a self-hash. This scope change was verified by source read; final manifest regeneration is required after this frozen report update. Earlier checkpoint QA source remains outside this checkpoint's hash scope, though referenced relative imports must exist in Git. Final staging must still inspect the full changed/new Git inventory and distinguish source coverage from historical probe hashes.

The current audit verifies normalized-LF hashes against its manifest, tracked existence of literal relative targets and whitespace. It deliberately skips node_modules imports and bare package imports. It does not resolve computed path imports, recursively validate CSS @import/URL assets, perform a lockfile supply-chain audit, scan all secrets/PII or validate runtime behavior. Its local-path regex is narrower than the expanded review scan. A passing audit is useful source-integrity/closure evidence within those scopes; it cannot replace final clean-checkout installs/tests, source/evidence hashes and CI on the pushed head.

Lead retains final manifest generation, staging, complete file-list review, clean implementation verification and publication. No heavy resource was started or remains owned by this review.

This report is FROZEN-DOC-FOR-CHECKPOINT after the exact quoting-fixture exception review. Agent C will make no further document edits until an explicit new handoff; the lead can regenerate the manifest once and stage/commit the resulting snapshot.
