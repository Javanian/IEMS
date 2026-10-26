# Published acceptance index

This index points to the final attestation for each published runtime head. Statements elsewhere saying remote acceptance was pending describe the source-freeze stage. They remain historical records. Acceptance applies to the exact SHA and documented scope below; later descendants require their own gates.

## Findings and dependency heads

| Checkpoint | Published runtime SHA | Final attestation | Accepted scope |
| --- | --- | --- | --- |
| Five findings, PR12 | `f4cf6fd44f497487948518712f1d400643112ce3` | [PR12 final attestation](https://github.com/Javanian/IEMS/pull/12) | F1–F4 VERIFIED within their acceptance boundaries, including original E01; F5 BLOCKED |
| Company stock use, PR13 | `9ad677a3fabedbe2005cdb2fefbc8d0e7d8ee140` | [PR13 final attestation](https://github.com/Javanian/IEMS/pull/13) | One-generation V1-to-V2 internal consumption, exact identities, conservation and conservative inherited holds |
| Company unit trace, PR14 | `23d2023af37cc49a5550e1c090eab918decf1532` | [PR14 final attestation](https://github.com/Javanian/IEMS/pull/14) | Read-only selected-unit trace and bounded reverse impact; V2 stays LEAF_ONLY |

The PR descriptions contain final SHA, CI links, retained failures and release limits. On 2026-10-26, PR13 and PR14 were re-read as open, unmerged drafts, each with 12 successful checks on its exact listed head. PR14's base is exactly PR13's head. This is dependency verification, not merge approval. [The dependency review](DEPENDENCY-REVIEW-13-14.md) records an open P2 readiness finding.

## Exact-head workflow links

| Head | Push Portfolio | PR Portfolio | Final reported gates |
| --- | --- | --- | --- |
| PR12 `f4cf6fd` | [40174124286](https://github.com/Javanian/IEMS/actions/runs/40174124286) | [40174126496](https://github.com/Javanian/IEMS/actions/runs/40174126496) | API266, frontend162, normal browser149 with zero application exceptions/console errors, separate intentional module recovery4 |
| PR13 `9ad677a` | [40182961352 attempt2](https://github.com/Javanian/IEMS/actions/runs/40182961352/attempts/2) | [40183023260](https://github.com/Javanian/IEMS/actions/runs/40183023260) | API278, frontend172, independent company15, normal browser153 with zero application exceptions/console errors, module recovery4 |
| PR14 `23d2023` | [40202403043](https://github.com/Javanian/IEMS/actions/runs/40202403043) | [40202407142](https://github.com/Javanian/IEMS/actions/runs/40202407142) | API285, frontend193, independent trace9, normal browser156 with zero application exceptions/console errors, module recovery4 |

The external final records were also read: PR12 `final-pr12-attestation-f4cf6fd.md`, PR13 `publication-ci-attestation-9ad677a.json`, and PR14 `final-publication-attestation.json`. Raw logs, pixels, ZIPs and databases remain external. Earlier failed attempts remain failed; a later pass does not establish their unknown historical cause.

## Scope and next work

F1–F4 are not reopened merely because general graph or company-stock customer dispatch is unfinished. Those are domain extensions beyond the accepted original E01 and the labeled supplemental workflows. An E01 order may remain OPEN while its accepted invoice settlement is complete, as documented in the original contract.

F5 remains a separate design and proof problem. Fully measured distinct-resource C8 combinations meet the initial HTTP target; incomplete cells and higher-concurrency contention remain visible. [CONCURRENCY.md](CONCURRENCY.md) retains the frozen measurements. [F5-DESIGN-PLAN.md](F5-DESIGN-PLAN.md) defines the next dedicated increment, with HTTP latency, admission queue and queue-inclusive time kept separate.

Review PR13, then PR14; resolve the P2 readiness mismatch before recommending merge. Next establish F5's authorization contract and revocation proof before adopting an optimization. Continue entitlement and dispatch in their actual domain dependency order. General graph mutation needs a concrete downstream flow and invariants before it is added. No merge or deployment is implied by this index.
