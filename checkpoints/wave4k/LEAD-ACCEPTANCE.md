# Wave4k K1 lead acceptance

Bounded K1 local acceptance completed, 2026-10-24. Branch `feat/manufacturing-lot-genealogy`, baseline `4b9eab05355558c0599fe4d054d16b076e8d88d7`. Use `git log -1` for the checkpoint commit; no remote publication is implied.

## Executed evidence

| Gate | Result |
| --- | --- |
| API owner dedicated HTTP | Final owner-genealogy.tap: 10/10 pass, exit0, no skipped tests |
| Maintained API regression | 32 files,196/196 pass, exit0, no skipped tests |
| Frontend regression | Lead frontend-tests-final.log:65/65 pass, exit0, no skipped tests |
| Independent hold/shipment probe | Authored separately and executed by lead:7/7 pass, exit0, no skipped tests |
| Production web build | Pass, including PWA generation; existing Browserslist/chunk-size warnings retained |
| Complete connected browser, ten additive switches | Final attempt3:104 checks,0 exceptions,0 console errors, exit0; earlier attempt2 also104/0/0 |
| Publication source/import audit | Final227 files/246 relative import edges, diff check0, zero errors |
| Lead visual review | Eight final editable/frozen screenshots at1440/768/375/360 inspected; mobile source table scroll verified with actual keyboard input |

## Preserved findings and failure dispositions

Owner attempt1 reported7 passing and2 failing tests because the corrupted-source test helper fetched a genealogy view before its intended POST. GET correctly rejected the deliberately corrupted movement, causing the helper to stop before POST. The test now captures versions before corruption and asserts both GET and POST denial. No product validation was relaxed. Owner attempt2 and the final owner-genealogy.tap each passed10/10.

Read-only independent review found a UI link to an unmounted hold-detail route. The UI now links to the existing receipt hold/release panel and keeps the hold ID visible. Final browser verification must include this recovery context.

Mongo teardown can emit existing ECONNRESET diagnostics while the test runner reports pass/exit0. Preserve complete logs; these results do not establish a flake-free lifecycle. Existing build warnings and any later findings are recorded below when executed.

Browser attempt1 stopped during Chrome startup: Windows temporarily locked the owned profile's DevToolsActivePort file (EBUSY). The existing bounded readiness loop now retries EBUSY alongside file-not-yet-present ENOENT, retaining the same60-second deadline, process-exit detection and error behavior for other failures. Application code and assertions were unchanged.

The independent probe verifies deterministic pre-transaction commit orderings after middleware authorization. It does not inject an internal two-snapshot barrier or establish every Mongo interleaving; qa/README.md explains the shared authorization fences and entire auth-collection snapshot exclusions. Source review separately checked the common receipt/head/WO writes.

Browser attempt2 passed all104 checks. Lead visual inspection of editable/frozen desktop and mobile screenshots then found the source table compressed lot identifiers into a very narrow first column at360px. A scoped minimum table width now retains readable columns inside the existing horizontal scroll wrapper, with a focusable named region, visible keyboard focus and an explicit scroll hint. Final frontend65/65 and build passed after this correction. Attempt3 passed104/0/0 with actual ArrowRight scrolling and retained source-column width at768/375/360. Frozen mobile screenshots include the focused, horizontally scrolled table; the whole table is intentionally wider than its contained viewport. API source/tests were hash-checked unchanged against55 files in the earlier source snapshot, so maintained HTTP and independent results still apply.

The connected browser journey was authored by the UI owner and executed by lead. It uses native controls for planning, allocations, losses, finalization and shipment, with actual authenticated API setup for the preceding bounded commercial/receipt/operation/QC records. Direct Node API pagination checks and Mongo assertions are separate from native DOM interactions. Only the dedicated qa/ HTTP probe was independently authored. The deliberate1/5/4 dispatches test first-shipment freezing within WO6/4; they do not claim canonical E01 delivery or monetary parity.

## Reproducible commands and scope

Use Node24 and cached MongoDB7.0.14 with the owned marked disposable helper. Heavy jobs execute sequentially. Set MONGOMS_SYSTEM_BINARY to the local cached executable and TMPDIR to the external evidence directory when running on this Windows host.

```powershell
node --test --test-concurrency=1 --test-reporter=tap test/wave4k-genealogy.test.mjs
# From apps/portfolio-api:
node scripts/test-maintained.mjs
# From repository root:
npm --prefix apps/web run test:portfolio
node --test --test-concurrency=1 --test-reporter=tap checkpoints/wave4k/qa/hold-shipment-fence.test.mjs
npm --prefix apps/web run build
python checkpoints/wave4k/build-manifest.py
python checkpoints/wave4h/audit-publication.py checkpoints/wave4k/SOURCE-MANIFEST.json
```

For the complete connected browser, run apps/web/test/portfolio-browser.mjs with PORTFOLIO_PAGINATION, REPAIR, DOCUMENTS, WMS, ENGINEERING, LABOR, VAT, INQUIRY, LOT_SERIAL and GENEALOGY all set to1 (each has the PORTFOLIO_ prefix). Use its owned service cleanup and external evidence path. A source/fixture assertion is not a native browser interaction.

Evidence is external at `D:/Project AI/GITHUB/IEMS-evidence/wave4k-20261024/`. SOURCE-MANIFEST.json binds source with CRLF normalized to LF; raw evidence hashes belong in the external verification manifest. Original main, CRM and accepted Wave4j worktrees are preserved. No push, merge, deployment, live broker/provider, production or statutory-tax proof is included.

K1 is consumed-lot attribution. K2 component-serial custody/installation/cycle prevention, controlled POD and independent full original E01 parity remain open. Canonical five lots/ratios/ten outputs in a bounded K1 test do not establish the original engineering, labor, QC certificate, date, delivery or financial acceptance chain.
