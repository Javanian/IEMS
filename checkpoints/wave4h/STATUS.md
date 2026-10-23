# Wave4h local WIP checkpoint

This commit preserves the stopped API/renderer/frontend source and dedicated tests at the user's explicit checkpoint request. It is NOT an accepted release or a reproducibility claim.

Base: d80bab34ed156a2cc4ad3d7779e2320638c74a16 (customer-service preview dependency).
Original dirty main checkout was not switched, reset, cleaned or staged.
SOURCE-MANIFEST.json enumerates the exact snapshot and SHA-256 hashes.

Provider-reported results: maintained API 155 passed, renderer 17 passed; original full run retains one obsolete unsupported-VAT-PDF assertion failure. Browser owner reports two sequential runs of 81 checks (75 baseline + 6 VAT), 19 light tests, and four rasterized downloaded PDFs reviewed. These are owner reports, not lead acceptance.

Independent original-checkout browser acceptance is now lead-reported at 81 checks, exit 0; this is not worktree acceptance. No heavy verification is authorized for this integration pass. API/renderer/frontend writers have stopped. VAT quote/SO total is gross; explicit netAmount/taxAmount/grossAmount are the consumer contract. FIXTURE_VAT_11_V1 is a versioned fixture policy, not statutory compliance.

Remaining gates:
- Independent QA disposition and lead final-source acceptance.
- Selective router/entrypoint/proxy mounting is integrated; unrelated legacy edits remain excluded. Four missing Wave4f browser helpers and the portfolio page entry were individually reviewed and copied.
- Portable owned Mongo configuration is integrated across all portfolio harnesses: MONGOMS_SYSTEM_BINARY override or mongodb-memory-server 7.0.14 download. Absolute original-checkout ledger imports are now local. Native smoke no longer depends on unpublished ops/job13.
- Final corrected original browser files were copied; source hashes are recorded in INTEGRATION-SOURCES.json. Additional browser harness changes only select portable Mongo/Chrome paths and external default evidence location.
- Static transitive import audit and exact source manifest are provided. Clean installation, tests, build and connected browser acceptance from this worktree are still pending. No Mongo/browser/build/install was run in this static-only pass.
- See PUBLICATION.md for sequential clean-install/test/build/browser commands and external prerequisites. No backend src or renderer business logic was changed.
- Final reports, remaining E01 gaps, staged publication, push and PR.

No daemon, image pull, container, shared PostgreSQL mutation, production cutover or live messaging is authorized by this checkpoint. Full E01 and repair VAT remain outside this increment. No push or merge accompanies this local checkpoint.
