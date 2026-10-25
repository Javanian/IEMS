# Five findings implementation status

Baseline: `54a7e6db5fb1cfc48252477ca872d700c8c650ee`, accepted controlled catalog QC and putaway. This integration branch is `feat/review-five-findings`. Existing checkpoints and the original dirty checkout are preserved. The earlier review's uncommitted-QC observation is superseded by this verified local commit, not by an assumption that all operations are complete.

| Finding | Status | Current evidence and remaining gate |
| --- | --- | --- |
| F1 complete operations | IN_PROGRESS | Actual typed reservation/issue/consume/output and core E01 through POD/settlement passed owned API and independent probes; final native browser and full integration acceptance pending; historical event-time adapter limits explicit |
| F2 publication | IN_PROGRESS | Accepted descendants published as stacked draft PR5-11; all exact published heads passed basic CI and Portfolio acceptance. Six locked clean installs passed. New integration commit/remote-head checks and final clean reproduction pending |
| F3 operator UI | IN_PROGRESS | Existing English PF interface retained; action queues, friendly identifiers, audit disclosure and before/after browser proof required |
| F4 source pickers | IN_PROGRESS |250-item/vendor API, authoritative hydration/current eligibility, atomic prefix projection and rare/no-match selective EXPLAIN passed. Native outside-page create/revise/approval and response ordering acceptance pending |
| F5 concurrency | BLOCKED | Same frozen baseline across attempt1+resume:26062 retained cold/warm commands,65/96 complete cells,1 partial and30 wholly UNTESTED. Resume added3 complete cells then hit the unchanged1.5GiB RAM floor. Material contention/missing capacity conditions remain; no after-optimization claim or unproved fence removal |

Original requirements are the unchanged `packages/domain-test-fixtures/src/scenarios/e01ManufacturingTenUnits.js`, its domain tests, and the manufacturing acceptance requirements transcribed in CONTRACT.md. Supplemental typed company production remains labeled separately. No source test count represents completion percentage. No automatic merge, deployment, external messaging or production/provider acceptance is included.

See WORK-OWNERSHIP.md, CONTRACT.md, CONCURRENCY.md, UX-REVIEW.md, TEST-RESULTS.md, PUBLICATION.md and LEAD-ACCEPTANCE.md for evidence and limitations. Raw evidence stays outside Git; public reproduction commands use repository-relative paths.
