# Wave4j continuation status

Implemented locally on `feat/manufacturing-lot-serial`, based on PR4 head `8324b02`. This local checkpoint records the accepted implementation and the next development plan. Use `git log -1` for its commit identity. No push, PR creation, merge or deployment is included.

| Area | Current evidence |
| --- | --- |
| Immutable receipt lot/heat through reservation and consumption | Implemented; owner HTTP tests pass |
| Ten unique output serials across WO6/4 | Owner HTTP and final connected browser pass through QC, reload and dispatch |
| Exact QC partition and accepted-unit shipment selection | Implemented; owner HTTP tests pass |
| Transaction rollback, duplicate namespace and failed-key effects | Owner HTTP tests pass |
| Concurrent shipment of the same unit and revoked replay | Independently authored HTTP probe, executed by lead: 5/5 pass |
| Semantic quote provenance and restricted inquiry entry | Local PR4 corrections; HTTP/component tests and restricted-role browser journey pass |
| Maintained API regression | 31 files, 186/186 pass, no skipped tests |
| Frontend regression | 57/57 pass |
| Production web build | Pass; existing Browserslist and chunk-size warnings retained |
| Complete connected browser | Final all-nine-flags run: 94 checks, 0 exceptions, 0 console errors, exit 0; earlier failures preserved |

Bounded local acceptance is complete; see LEAD-ACCEPTANCE.md. No remote publication or merge is implied. Source/import audit and preserved raw evidence are tied to the final source manifest.

Full E01 remains PARTIAL. Next increments are Wave4k component genealogy, Wave4l controlled delivery/POD, then Wave4m independent full inquiry-to-settlement acceptance. WO-level material context is not per-unit installed-component genealogy. SHIPPED remains an operator-recorded dispatch status, not physical delivery proof.

DEVELOPMENT-PLAN.md and BACKLOG.csv define the next implementation slices, invariants, dependencies and independent gates. Wave4k is split into consumed-lot attribution and serialized-component custody/graph safety. All K/L/M tasks are PLANNED; their behavior is not implemented or accepted by the Wave4j evidence.

PR4 is still open remotely at its earlier head; this branch contains its two additional local corrections. Merge and remote CI status must be checked at the eventual publishing head. No production, statutory tax, SAP, WhatsApp, cloud, broker or cutover acceptance is claimed. Original dirty main checkout and the two untracked CRM TAP files remain preserved.
