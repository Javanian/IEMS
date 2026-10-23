# Wave4h lead acceptance

Accepted scope: versioned fixture-VAT quote/invoice presentation and PDF issuance in the local portfolio workflow. Implementation at de6f3ae was verified in a separate worktree after clean installation. Publication housekeeping changes test entry points, audit portability, documentation and CI; it does not change product business logic.

## Evidence reviewed

| Gate | Recorded publication-worktree result |
| --- | --- |
| Maintained API, 27 files | 155 passed, 0 failed/skipped |
| Frontend unit tests | 44 passed |
| Renderer historical tests | 13 passed |
| Renderer VAT tests | 4 passed |
| Renderer public TypeScript contract | Passed |
| Web production build | Passed; chunk-size/Browserslist warnings remain |
| Connected browser, all six flags plus VAT, customer service enabled | 81 checks, 0 exceptions, 0 console errors |

The lead publication API and browser raw logs were inspected during finalization. Independent QA also recorded canonical API and boundary checks, receipt hash comparisons, parsing, 150-dpi rasterization and visual review of four issued PDFs: quote R1, quote R2 and invoices for partial quantities 6 and 4. That visual evidence is limited to those four pages; it is not pagination or every-currency certification.

The source manifest and import audit is rerun for the final publication commit. Remote checks must be read from the actual PR head and are not inferred from these local results.

## Failure disposition

- The original Wave4g probe expects VAT PDF rejection and remains unchanged. Its failure is retained; the current contract is covered by Wave4h positive issuance and negative-boundary tests.
- Independent browser recovery originally failed before VAT. The corrected harness verifies a new document, genuine 403/403/200 recovery and unchanged invoice/payment state. Subsequent lead and publication-worktree runs reached all 81 checks. Earlier failures were not overwritten.
- The first publication browser invocation lacked installed bridge dependencies. The bridge lock was installed before the successful rerun; reproduction and CI now include it.
- Wrong-working-directory renderer attempts and the invalid typecheck script invocation were preserved as failed attempts, not passes.
- Mongo shutdown ECONNRESET diagnostics and web build warnings remain recorded; they are distinct from browser console-error counts.
- A final audit invocation exposed Windows default-encoding failure. Reads are now explicitly UTF-8 and manifest hashing normalizes CRLF to LF for clean checkouts.

- First remote CI passed the maintained API suite but failed one historical renderer recovery test because worker command-line parsing assumed quoted paths. The correction accepts quoted or unquoted exact script paths, retains creation-time checks, and additionally checks PID and IPC identity. A parser regression test is added; this is a harness correction, not a VAT behavior change. Original remote failure: https://github.com/Javanian/IEMS/actions/runs/39977936872.

## Limits and merge order

PR #1 must provide the customer-service dependency before this change reaches main. Keep this PR dependent on feat/customer-service-preview while that prerequisite is open. No automatic merge or release promotion is authorized by this acceptance.

Full E01, repair VAT, statutory tax compliance, lot/serial genealogy, POD, live providers, RabbitMQ persistence, shared-database incident remediation and production cutover remain open or outside this slice. See E01-REMAINING-GAPS.md. No production deployment is claimed.
