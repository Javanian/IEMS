# Publication and dependency tracking

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
