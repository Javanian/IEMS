# Publication and dependency

This source is not yet committed or published. Final current-head checks and attestation must be linked here and from the associated draft PR before publication is accepted. Historical source-freeze notes remain historical.

| Candidate | Starting source | Review base |
| --- | --- | --- |
| Company-stock readiness correction |PR14,23d2023, new fix/company-stock-readiness branch |feat/company-stock-trace |
| Isolated F5-A proof |Accepted P2 checkpoint, planned separate test/f5a-authorization-proof branch |fix/company-stock-readiness |
| Purchased dispatch final integration |PR15,692463a, planned feat/purchased-dispatch-followup branch |feat/quote-catalog-entitlement |

The verified remote dependency remains PR12 -> PR13 -> PR14 -> PR15. PR16,9a1e4e7, is a documentation sibling of PR15; its twelve checks were re-read SUCCESS, not assumed from its earlier pending snapshot. Its [acceptance index](https://github.com/Javanian/IEMS/blob/docs/acceptance-and-f5/checkpoints/review-five-findings/ACCEPTANCE-INDEX.md) links final earlier attestations without rewriting their historical notes.

The final PR15 descendant will use a normal local merge of the accepted P2/F5-A ancestry, then three-way integration of the reviewed original WIP snapshot. Shared workflow/audit/ignore/manifest changes are reconciled explicitly. Original dirty checkout/index and masters remain protected. No rebase, force push, remote merge or deployment is part of this work.

Raw logs, screenshots, ZIPs, disposable databases and credentials are excluded from Git. SOURCE-MANIFEST hashes normalize CRLF to LF; external evidence retains raw bytes and their separate association. Only reviewed changed paths are staged. Source/import closure, artifact exclusion, preservation, tested-source association and exact remote head must all pass before the final attestation is accepted.
