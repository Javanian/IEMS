# Wave4k K1 handoff

Branch `feat/manufacturing-lot-genealogy`, baseline `4b9eab05355558c0599fe4d054d16b076e8d88d7`. Use `git log -1` and STATUS.md for the accepted local checkpoint. Work only in this genealogy worktree; the dirty older main, CRM and accepted Wave4j worktrees are separate.

CONTRACT.md freezes the payloads, capabilities, source identity, hold rules and limits. This slice adds consumed-lot attribution per manufactured output. It does not allocate incoming component serials or prove physical installation. Existing quantity-only and serialized WOs remain compatible unless planning explicitly sets both `serialized: true` and `genealogyRequired: true`.

## Implementation boundaries

- `apps/portfolio-api/src/genealogy.mjs` owns current heads, immutable revisions, effective allocations, per-source balances and the attribution ledger. Mutations use the existing manufacturing transaction, committing authorization guard, version checks and durable command receipts. No stock quantity is consumed again.
- `manufacturing.mjs` registers the dedicated genealogy capabilities and roles, the opt-in and shared release checks. A required split has at most 100 integral output units and 20 traced source receipts. Per-unit commands keep the existing 32kb request limit.
- `fulfillment.mjs` calls `freezeShipmentGenealogy` inside its shipment transaction. First shipment freezes the whole WO. Every new shipment, including remaining units of a frozen WO, checks authoritative source holds and writes the same receipts that hold commands write. Shipment sources, SHIP movements and selected output units store the finalized revision/hash pointer.
- `GenealogyWorkspace.jsx` exposes source reconciliation, explicit per-unit quantities, process losses, finalization, immutable revisions and effective reverse tracing. Uncertain commands retain their exact payload and key for retry. A held source remains visible after consumption; historical attribution is allowed, fresh finalization/dispatch is blocked.

## Verification and continuation

Owner HTTP tests are in `apps/portfolio-api/test/wave4k-genealogy.test.mjs`. Independently authored adversarial probes and their exact boundary are under `qa/`. The connected browser switch is `PORTFOLIO_GENEALOGY=1`, additive to the nine accepted earlier switches. Read LEAD-ACCEPTANCE.md for executed results; authored tests alone are not acceptance.

Keep raw TAP, browser screenshots, service logs and verification hashes outside Git at `D:/Project AI/GITHUB/IEMS-evidence/wave4k-20261024/`. Use cached MongoDB 7.0.14 and owned disposable databases only; heavy jobs run sequentially. Dependency junctions reuse existing installed modules without changing lockfiles. SOURCE-MANIFEST.json hashes source with CRLF normalized to LF and is checked by the existing Wave4h publication audit.

After bounded K1 acceptance, the next task is the separate K2 serial-custody and graph-conflict contract. Preserve incoming claim-before-consumption, shared stock/custody fences, one active parent, concurrent cycle prevention and controlled removal rules from the Wave4j development plan. K2, delivery/POD, full E01 parity, external integration and production remain separate gates. Local acceptance does not publish, merge or deploy the branch.
