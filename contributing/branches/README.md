# Branches and merge policy

`main` is the integration baseline. Changes reach it through pull requests with passing CI. Feature branches hold bounded increments; open a draft PR after the first reviewable change and push further tested commits there.

## Work areas

| Branch | Scope | Current state |
| --- | --- | --- |
| `feat/customer-service-preview` | Complaint tickets, operator handoff and gated messaging previews | Implementation in draft PR #1 |
| `feat/crm-order-management` | CRM stages, inquiries, quotes and sales order workflow | Prepared from `main`; no new implementation commits |
| `feat/mes-shopfloor-quality` | Work orders, shop-floor execution, quality and rework | Prepared from `main`; no new implementation commits |
| `feat/warehouse-procurement` | Inventory, reservations, PR/PO and receiving | Prepared from `main`; no new implementation commits |
| `feat/data-platform-pipelines` | Ingestion, streaming, dbt models and data quality | Prepared from `main`; no new implementation commits |
| `feat/ai-rag-assistant` | Scoped retrieval, order assistance and agent evaluation | Prepared from `main`; no new implementation commits |
| `infra/local-deployment` | Local deployment, Terraform configuration and operational verification | Prepared from `main`; no new implementation commits |
| `chore/repository-governance` | Branch policy and contribution guidance | This policy change |

These scopes are work assignments, not completion claims. Split large work areas into smaller task branches when implementation starts. Keep shared contracts in separate, reviewable changes and merge dependencies before dependent PRs. Refresh inactive branches from the current baseline before starting work. Delete merged branches once their work is complete; branch count is not a progress metric.

## Main protection

The following repository settings were applied and read back through the GitHub API on 2026-10-23:

- Pull requests are required, including for administrators.
- Force pushes and branch deletion are disabled.
- The branch must be up to date with `main` before merging.
- Review conversations must be resolved.
- Five status checks must pass, with GitHub Actions as the expected reporting app:
  - `API tests`
  - `Web build`
  - `Python unit tests`
  - `Domain contracts and fixtures`
  - `Kafka integration (real broker and PostgreSQL)`

The minimum approving reviewer count is zero for the current solo-maintainer workflow. This still requires a PR and CI, but it does not provide independent review. When another maintainer joins, raise the count to one. Stale approvals are dismissed after new commits. Admins can edit repository settings; protection is not an immutable security boundary.

Feature-specific checks must also pass when relevant. The preview CI workflow is path-filtered and is not a global required check, so unrelated changes are not blocked waiting for a workflow that never runs. Protection settings live on GitHub; this document records them and does not automatically restore them.

## Working on a change

1. Fetch `origin` and use the branch assigned to the task, preferably in a separate worktree if another checkout has uncommitted changes.
2. Commit one coherent change with its tests and dependency locks. Use actual authorship and timestamps.
3. Push the branch and open a draft PR describing behavior, verification and remaining limitations.
4. Update the branch for changes to `main`, resolve conflicts, and let CI run again. Mark the PR ready when its acceptance scope is met.
5. Review the diff and checks, resolve discussions, and merge through GitHub. Preserve meaningful development commits when choosing a merge strategy.

Branch protection controls merging; it does not certify production readiness. Deployment approval, backup restoration, migration rehearsal and live integration evidence remain separate release requirements.

Reference: [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
