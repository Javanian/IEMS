# Wave4h VAT publication status

Decision: accepted for a bounded local development preview. Remote CI is a separate gate; see the pull request checks. Full E01 and production acceptance remain open.

Implementation checkpoint: de6f3ae, following 9f4ed18. Dependency base: d80bab3 on feat/customer-service-preview (PR #1). This is a dependent PR; the portfolio API and UI needed by VAT are included because they are not yet on main. The original dirty checkout has not been switched, reset or staged.

Verified publication-worktree results: maintained API 155/155, frontend units 44/44, renderer historical 13/13 plus VAT 4/4, renderer public types and production build passed. Connected browser acceptance completed 81 checks with zero exceptions and console errors. These are local results; generated PDFs, screenshots, logs and databases remain excluded from this publication.

VAT quote/invoice use schema 2 and template 3. NO_TAX schema 1/templates 1 and 2 remain supported. VAT quote/SO total is gross; line amount is net, and explicit netAmount/taxAmount/grossAmount are authoritative. FIXTURE_VAT_11_V1 is a fixture policy, not a statutory compliance claim.

The final publication pass corrects stale instructions, adds maintained test commands and focused CI, and makes the manifest audit explicitly UTF-8 and independent of CRLF/LF checkout conversion. Historical failing probes remain unchanged. SOURCE-MANIFEST.json uses SHA-256 over UTF-8 file bytes with CRLF normalized to LF; it excludes itself and generated runtime evidence.

See LEAD-ACCEPTANCE.md for evidence disposition, PUBLICATION.md for reproduction and E01-REMAINING-GAPS.md for the remaining manufacturing work. No RabbitMQ daemon, container, live messaging, cloud deployment or merge is part of this publication.
