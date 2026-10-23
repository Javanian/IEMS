# Development workflow

Keep work in short-lived branches such as `feat/customer-service-preview` or `fix/invoice-rounding`. Open a draft pull request after the first coherent, tested change so implementation and review progress are visible before the entire feature is complete.

## Commits and review

Each commit should describe one reviewable change. Commit source, dependency locks and relevant tests together. Use the actual author and timestamp; do not manufacture activity or backdate milestones. Push tested increments to the feature branch. Preserve review history after a PR is opened, and avoid force pushes.

Before committing, inspect `git diff --cached` and `git diff --cached --check`. Stage explicit paths. Keep credentials, personal messages, database exports, local logs and generated binaries out of Git. A `.gitignore` file belongs in the repository; adding a rule does not remove a file that is already tracked.

Include the problem, changed behavior, exact validation and remaining limitations in the PR. Mark it ready when its acceptance scope is met and required CI checks pass. Merge through the PR after review. Branch protection and required checks are repository settings; this guide does not configure them.

## Customer service preview checks

Use Node.js 24. Run from the repository root:

```sh
npm ci --prefix packages/customer-service --workspaces=false --ignore-scripts
npm ci --prefix apps/wa-demo-bridge --workspaces=false --ignore-scripts
npm run typecheck --prefix packages/customer-service
npm test --prefix packages/customer-service
npm test --prefix apps/wa-demo-bridge
```

The suites launch disposable MongoDB 7.0.14 replica sets. The first run downloads a binary; `MONGOMS_SYSTEM_BINARY` can select a local installation. Tests use synthetic data and kill only their own crash-test workers. The dedicated Windows CI job runs the same package commands.

## Release checkpoints

Use a prerelease for a bounded preview and describe what was verified. Passing local tests does not establish deployment readiness. Production requires environment-specific evidence for migrations, backup restoration, access controls, monitoring, rollback and any enabled external integration. The WhatsApp bridge currently supports local previews only; no customer messages are sent.
