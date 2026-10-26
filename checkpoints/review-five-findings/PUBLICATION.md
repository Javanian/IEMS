# Publication and dependency tracking

Final published acceptance is linked in the [PR12–14 acceptance index](ACCEPTANCE-INDEX.md), with exact runtime SHAs and workflow attempts. Publication-in-progress statements below describe their historical stage and are preserved.

Remote inventory was read before mutation: main5e200eb; PR4 remains open at8324b02 and is not merged. Accepted local descendant chain is4b9eab0 →2b66c85 →f2d6f4a →cfb1b98 →bd6d7f2 →ae0602a →54a7e6d. Branches correspond to actual commits and features. No empty branch or retrospective metadata is created.

Publication is in progress. Each staged PR targets its actual predecessor feature branch, with the first targeting feat/crm-order-management. Record exact tested/pushed SHA, URL and remote-head checks after execution. Parent merge requires retargeting/relevant checks; no automatic merge, protection bypass, history rewrite, force push or deployment is authorized. Existing local checkpoint histories/dates/parents are preserved.

| PR | Head SHA | Base dependency |
| --- | --- | --- |
| [5](https://github.com/Javanian/IEMS/pull/5) |4b9eab05355558c0599fe4d054d16b076e8d88d7 | PR4 / feat/crm-order-management |
| [6](https://github.com/Javanian/IEMS/pull/6) |2b66c853a3ef4420b7fb899b4af75af230873f7b | PR5 / feat/manufacturing-lot-serial |
| [7](https://github.com/Javanian/IEMS/pull/7) |f2d6f4a5883281e8455a353d9d83c14c50698aab | PR6 / feat/manufacturing-lot-genealogy |
| [8](https://github.com/Javanian/IEMS/pull/8) |cfb1b989b45fa7b02d8e24cfa51e52679a48bf3e | PR7 / feat/manufacturing-serial-custody |
| [9](https://github.com/Javanian/IEMS/pull/9) |bd6d7f2b7ec6404a5b6c4fa31db55c1154bfcec3 | PR8 / feat/manufacturing-serial-installation |
| [10](https://github.com/Javanian/IEMS/pull/10) |ae0602a7a24f87050b66e754d86eef4f0b38ca50 | PR9 / feat/manufacturing-internal-planning |
| [11](https://github.com/Javanian/IEMS/pull/11) |54a7e6db5fb1cfc48252477ca872d700c8c650ee | PR10 / feat/catalog-procurement-receipts |

These are real original accepted commits, published without rewriting dates/parents or moving protected local checkpoint worktrees. Both basic CI and Portfolio VAT acceptance now passed all seven exact published heads. This does not accept the new integration source. PR9 portfolio attempt1 reached the genealogy browser role/reload transition and failed with CDP `Inspected target navigated or closed`, with no browser exception/console error before it. Its raw remote log is retained externally; attempt2 passed on the identical SHA. The first failure is retained as a browser harness navigation flake, not erased or counted as a pass.

| PR | Successful Portfolio acceptance run |
| --- | --- |
| 5 | [40159627968](https://github.com/Javanian/IEMS/actions/runs/40159627968) |
| 6 | [40159649596](https://github.com/Javanian/IEMS/actions/runs/40159649596) |
| 7 | [40159655878](https://github.com/Javanian/IEMS/actions/runs/40159655878) |
| 8 | [40159659325](https://github.com/Javanian/IEMS/actions/runs/40159659325) |
| 9 | [40159663883, attempt2](https://github.com/Javanian/IEMS/actions/runs/40159663883/attempts/2) |
| 10 | [40159668058](https://github.com/Javanian/IEMS/actions/runs/40159668058) |
| 11 | [40159671788](https://github.com/Javanian/IEMS/actions/runs/40159671788) |

Source/import closure, tracked-file/security inspection and a clean install/test must precede publication acceptance. Raw evidence, generated PDFs/screenshots/databases, credentials and local environment files are excluded. The tracked .gitignore remains part of the source.

## Integration checkpoint under review

Commit `e322141ce992ca4283239d8730a1d8cddf53c641` was pushed normally to `feat/review-five-findings` with parent `54a7e6db5fb1cfc48252477ca872d700c8c650ee`. [Draft PR12](https://github.com/Javanian/IEMS/pull/12) targets `feat/catalog-receipt-qc-putaway` / PR11. This is an implementation checkpoint with F1-F4 still IN_PROGRESS and F5 BLOCKED, not final acceptance.

Before this push, the staged-source audit passed321 normalized hashes and541 literal relative-import edges. A targeted changed-source scan inspected129 staged files with zero raw-output candidates and zero targeted secret-pattern hits; its limits exclude historical/entropy/PII certification. The separate clean clone checked out this exact commit with no source changes and passed the same321/541 audit; final implementation install/tests remain a later gate.

At the first exact-head observation, [basic CI40167510186](https://github.com/Javanian/IEMS/actions/runs/40167510186) and [Portfolio acceptance40167510184](https://github.com/Javanian/IEMS/actions/runs/40167510184) were in progress. These are not pass claims. The latest local full browser stopped at68 checks on ticket text-enlargement evidence, with0 exceptions/console errors; investigation and final native regression continue. Subsequent commits must retain their own source and remote-head status.

Exact-head final observation: [basic CI40167510186](https://github.com/Javanian/IEMS/actions/runs/40167510186) succeeded all five jobs. [Portfolio acceptance40167510184](https://github.com/Javanian/IEMS/actions/runs/40167510184) failed in the old independent MAP full-business snapshot: the now-required vendor authority fence advanced12-to17, with all other fields unchanged. Later QC/independent/browser/API steps were skipped. This failure is retained; a bounded QA adapter preserves all business fields and matches fence increments to distinct newly durable receiving effects, with replay/rejection/rollback still exact-zero effects. Independent static review passed; runtime/future-head CI are separate gates. The exact e322141 clean clone passed all six locked installs and266/266 maintained API tests.

## Accepted runtime and subsequent recovery publication

Runtime source `5bdb765f4b123e20304b83582c60ab3829055879` was pushed normally and passed [basic CI40170267276](https://github.com/Javanian/IEMS/actions/runs/40170267276) and [Portfolio acceptance40170267280](https://github.com/Javanian/IEMS/actions/runs/40170267280). Every Portfolio step succeeded, including renderer types/tests, frontend162/162, clean production build, prior independent QA, current independent authorization/stock/picker/POD/E01/labor probes, benchmark-selector safety, full18-journey browser149 with zero browser errors and maintained API266/266. Full decoded remote log is retained externally as `remote-5bdb765-portfolio-success.log`.

Local exact-runtime reproduction additionally passed clean build6, unattended full browser9 and demo smoke3. Earlier six locked installs/full API were on e322141; Git independently confirms API/package source unchanged through5bdb765. Only two later presentation files changed and then passed current frontend/build/browser verification. The source manifest expanded from321/541 to335 hashes/550 literal relative-import edges, including historical QA and the global CSS implicated in text settling. The changed-source scan inspected130 tracked paths with zero raw-file/targeted-secret candidates; this is not entropy/history/PII certification. A current tracked filename check found no .env/private-key/Pem/key file.

Intermediate c53ac8e and ddc2962 basic CI succeeded; their Portfolio runs were CANCELLED by subsequent legitimate source pushes, not accepted. Original cancelled logs are retained as `remote-c53ac8e-portfolio-cancelled.log` and `remote-ddc2962-portfolio-cancelled.log`. The a707d18 intermediate run was likewise superseded after the separately retained local full8 failure. Failed e322141 MAP authority-fence snapshot and all local browser attempts remain recorded in TEST-RESULTS; no skipped/cancelled job is counted as a pass.

Documentation commit `67281a9d3b4b2d29904021d21fd6a15a6cac0749` retained byte-identical runtime source. Its [PR Portfolio run40171932417](https://github.com/Javanian/IEMS/actions/runs/40171932417) nevertheless failed during browser VAT navigation: the actual dynamic import of PortfolioPage.jsx failed after about70 checks and the default developer error screen appeared. No Vite transform failure or matching request interception was found in the available log; the transport cause remains UNKNOWN. The [same-SHA push run40171929105](https://github.com/Javanian/IEMS/actions/runs/40171929105) passed its complete browser and maintained API steps. Both basic workflows passed. The failed PR run remains failed, not accepted by substituting the push result.

The subsequent checkpoint adds actual recovery behavior: an eager portfolio route error boundary, a friendly English message and explicit native reload, with recovery-only48px controls. It neither automatically reloads nor retransmits a business command. A separate independent actual-browser request-abort/reload probe is added to CI after the unchanged normal18-journey browser gate. Intentional fault diagnostics are retained separately and never filtered out of the normal149-check zero-error baseline. This fixes the observed recovery UX gap; it does not claim to establish the unknown transport root cause.

The new source, tests, workflow and reports require their own remote-head checks before final handoff. The immutable final SHA, run URLs and observed results are attested in the final body of [PR12](https://github.com/Javanian/IEMS/pull/12), avoiding a self-embedded commit SHA and a report-only commit loop. Prior successful head checks do not transfer automatically. No merge, force push, date rewrite or deployment is performed.

Pre-publication recovery audit passed339 normalized source hashes and624 literal relative-import edges, now explicitly including router registration. The16 staged recovery paths had no raw-output or targeted secret-pattern candidates; limits remain current-content-only. Lead independently rechecked all12 original checkout HEAD/status snapshots and found exact matches. Recovery source is covered by frontend162/162, current production build and actual fault/native-reload probe6; final full normal-browser/API coverage is a separate remote-head gate.

External runtime evidence freeze `EVIDENCE-MANIFEST-RUNTIME-5bdb765.json` hashes1424 files/108344873 bytes, hash-list SHA256 `0628ba638eea43bf187a0d51d91dca18ad2df4f20149d50494dce140b32f726c`. It excludes the clean checkout, diagnostic UI snapshot, installed dependencies, .git and itself; later CI/publication attestation gets a separate final manifest, preserving the runtime freeze. Raw outputs and temporary demo credentials stay external. Twelve original worktrees are checked against their recorded HEAD/status before final handoff.
