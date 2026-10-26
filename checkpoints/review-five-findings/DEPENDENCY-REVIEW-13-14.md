# Dependency review: PR13 to PR14

Reviewed 2026-10-26 against published PR13 `9ad677a3fabedbe2005cdb2fefbc8d0e7d8ee140` and PR14 `23d2023af37cc49a5550e1c090eab918decf1532`. The Git merge-base equals PR13's head; PR14 targets that exact branch/head. Both original worktrees were clean and both PRs remain open drafts with 12 exact-head successful checks. [Final acceptance links](ACCEPTANCE-INDEX.md) preserve the separate local, remote and historical-attempt records.

## Open finding

**P2: company receipt readiness ignores the write-history budget.** [company-stock.mjs](../../apps/portfolio-api/src/company-stock.mjs) computes canReserve from source blockers and available quantity at line43. Its saveUse writer rejects more than100 reservation references or a source version at least501 at lines47–48. After100 retained released claims, available stock can therefore still be presented as reservable while a fresh101st claim is rejected with STOCK_HISTORY_LIMIT. The same readiness inconsistency exists at the event/version limit. This is inherited from PR13, not introduced by PR14's trace route.

This is a static source finding, not a newly executed maximum-size fixture. Transactional enforcement still rejects the command and rolls back its effects; no conservation or authorization bypass was identified. It does not invalidate the earlier bounded acceptance or prove full capacity. Before merge, expose the exhausted history budget in readiness/blockers and add a focused real-boundary regression. Keep immutable history and the writer caps intact; do not use a UI-only workaround or disable legitimate release/hold operations at an unrelated bound.

## Dependency assessment

PR13 supplies the actual company receipts, immutable selected units, V1 producer and V2 consumer evidence used by PR14. PR14's production delta is the trace module and narrow company-stock route/index registration. It does not change V1/V2 write policies. Trace requires company.stock.read, uses one snapshot, and does not write dependency/authorization fences, stock, keys, audit or outbox.

The exact output allocation remains distinct from the conservative union of actually consumed producer-batch receipts used for holds. Abandoned history does not become physical ancestry. V2 output remains LEAF_ONLY. Corrupt or missing source/reverse evidence fails closed; bounds return no partial trace. Independent trace acceptance covers32 executions accepted and33 refused; the other source-enforced maxima are not all positively certified at their maximum size.

No additional concrete trace-authority bypass was identified by this source review. It is not a comprehensive security, performance or merge certification. No runtime tests or benchmarks were repeated for this documentation review.

## Execution order

1. Close the P2 readiness mismatch within the existing company-use contract, then complete PR13 and PR14 review in dependency order. Preserve current-head checks and revalidate changed heads before merge.
2. Execute [F5-A](F5-DESIGN-PLAN.md): authority-writer inventory, precise revocation ordering and an independently tested candidate model, while production fences remain unchanged.
3. Revisit commercial entitlement and customer dispatch against approved source/cohort, identity, quantity and hold contracts. Published quotation entitlement and the separate uncommitted purchased-dispatch WIP are not proof that company-stock dispatch is accepted.
4. Add graph mutation only when the next concrete flow needs another generation or relationship operation and its cycle, ancestry, hold and dispatch-freeze invariants are specified.
