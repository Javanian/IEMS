# Company unit trace and quality investigation

Final published acceptance: [PR14 at23d2023 and its exact PR13 dependency](../review-five-findings/ACCEPTANCE-INDEX.md). See the [dependency review and open P2 finding](../review-five-findings/DEPENDENCY-REVIEW-13-14.md). The source-freeze description below is preserved.

This increment extends the one-generation company stock checkpoint with a read-only unit investigation. An operator selects a real stored company unit, traces its exact embodied inputs and sees how that identity was subsequently reserved, issued, consumed, allocated to an output or assigned to process loss. Physical ancestry and the conservative producer-batch hold scope are separate evidence.

The starting point is `9ad677a3fabedbe2005cdb2fefbc8d0e7d8ee140` on `feat/company-stock-use`, reviewed in [PR13](https://github.com/Javanian/IEMS/pull/13). Its twelve checks were revalidated before this work. Those checks do not accept the new source.

The master-plan mapping is P027 genealogy, P029 quality investigation and P042 acceptance. This is a bounded precursor to K2B2-05/06, which remain planned. It does not enable another manufactured generation, graph editing, removal/replacement, customer dispatch or an automatic recall/hold disposition. V1 and V2 production rules remain unchanged.

See [CONTRACT.md](CONTRACT.md), [WORK-OWNERSHIP.md](WORK-OWNERSHIP.md) and [TEST-RESULTS.md](TEST-RESULTS.md) for the frozen wire, ownership and actual verification results. Current-head publication is recorded separately from local checks.
