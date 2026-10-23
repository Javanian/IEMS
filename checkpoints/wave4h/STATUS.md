# Wave4h local WIP checkpoint

This commit preserves the stopped API/renderer/frontend source and dedicated tests at the user's explicit checkpoint request. It is NOT an accepted release or a reproducibility claim.

Base: d80bab34ed156a2cc4ad3d7779e2320638c74a16 (customer-service preview dependency).
Original dirty main checkout was not switched, reset, cleaned or staged.
SOURCE-MANIFEST.json enumerates the exact snapshot and SHA-256 hashes.

Provider-reported results: maintained API 155 passed, renderer 17 passed; original full run retains one obsolete unsupported-VAT-PDF assertion failure. Browser owner reports two sequential runs of 81 checks (75 baseline + 6 VAT), 19 light tests, and four rasterized downloaded PDFs reviewed. These are owner reports, not lead acceptance.

QA agent C is currently running independently in the original checkout; its active files and raw evidence are excluded from this checkpoint. API/renderer/frontend writers have stopped. VAT quote/SO total is gross; explicit netAmount/taxAmount/grossAmount are the consumer contract. FIXTURE_VAT_11_V1 is a versioned fixture policy, not statutory compliance.

Remaining gates:
- Independent QA disposition and lead final-source acceptance.
- Selective router/entrypoint/proxy mounting integration; unrelated existing web edits intentionally excluded.
- Portable owned Mongo test configuration (currently references an unpublished local binary cache).
- Complete transitive dependency audit, clean installation, build and connected browser acceptance from this worktree.
- Final reports, remaining E01 gaps, staged publication, push and PR.

No daemon, image pull, container, shared PostgreSQL mutation, production cutover or live messaging is authorized by this checkpoint. Full E01 and repair VAT remain outside this increment. No push or merge accompanies this local checkpoint.
