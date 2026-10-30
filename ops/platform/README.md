# Platform implementation runbook

All four roadmap IDs are implementation deliverables pending final integrated QA. Core
packages are injected adapters; see their READMEs and INTEGRATION.md for CTO registration.
The local profile runs the actual portfolio API plus owned job routes/worker on a synthetic
database, rather than patching shared app.mjs. `platform.persistence-probe` exists only in
this isolated profile and writes one run-owned record in the fenced effect transaction.

## Offline checks

`node --test packages/durable-jobs/jobs.test.mjs packages/cache-coordination/cache.test.mjs`
tests contracts with fakes; it is not live broker/Redis/Mongo acceptance.

`node ops/platform/terraform-offline.mjs` requires PAPERCLIP_RUN_SCRATCH_DIR and existing
Terraform plus PLATFORM_TF_PROVIDER_MIRROR containing hashicorp/aws 5.100.0. It copies the
offline root into scratch, runs fmt/init/validate/test with mirror-only installation and
dummy credentials. Exit 0 PASS, 1 FAIL, 2 NOT_RUN. Never run AWS apply for this fixture.

## Local lifecycle

Use the assigned platform branch with committed source and no competing heavy runtime.
Read actual listeners, owner labels and private state before changing services. A local
Docker engine, Terraform >=1.7 and installed kreuzwerker/docker 3.6.2 mirror are prerequisites.
No automatic installation is performed. Choose an unused loopback port and a new private
absolute state directory outside source (e.g. operator-owned evidence storage). Set
PLATFORM_TF_PROVIDER_MIRROR to the existing provider mirror. Then run:

```
node ops/platform/local-lifecycle.mjs up ABSOLUTE_PRIVATE_STATE_DIR 14313
node ops/platform/local-lifecycle.mjs health ABSOLUTE_PRIVATE_STATE_DIR
node ops/platform/local-lifecycle.mjs verify ABSOLUTE_PRIVATE_STATE_DIR
node ops/platform/local-lifecycle.mjs restart ABSOLUTE_PRIVATE_STATE_DIR
node ops/platform/local-lifecycle.mjs down ABSOLUTE_PRIVATE_STATE_DIR
```

`up` records owner/source identity, verifies clean assigned branch, free listener, local
Docker engine and Terraform mirror, builds the exact source image, plans/applies only the
owned local module, checks `/health` owner+source and seeds synthetic accounts. Seed password
is sent to docker exec over stdin, never a command argument. Logs/evidence redact generated
secrets. `verify` authenticates through the real session API, submits a job and checks both
SUCCEEDED state and exactly one Mongo effect record. `restart` requires that probe, restarts
only the exact owned containers and verifies the same job/record after restart. Redis loss
cannot erase the job. All commands have deadlines and propagate nonzero exit; unavailable
executables exit 2 NOT_RUN. Evidence records command/cwd/source/exit and health/probe results.

`down` validates Terraform state and live IDs against source+owner labels, plans/applies
owned destroy and verifies that the owner's containers/network/volumes are gone. This removes
only this synthetic deployment's data. It preserves local image caches and private evidence.
Never run Docker prune, kill unknown PIDs, delete arbitrary state or use a different state
directory to tear down resources. A lifecycle.lock prevents overlapping operations; a crash
leaves it for manual operator verification, never automatic stale-PID deletion.

## Failure and rollback

On apply/startup failure, preserve state and result JSON; do not launch a duplicate profile.
Use health to inspect the existing owner. Run down with that same state after reviewing the
failure to remove a partially applied synthetic profile. If a resource was removed outside
Terraform, live-ID verification fails closed; operator must reconcile state/ownership before
continuing, never import or delete unrelated resources. A new code candidate gets a new
private directory/owner; do not mutate an old candidate in place. No public push, paid cloud
apply, production deployment or user-data cutover is part of this runbook.

## Evidence boundaries

Current host has no Docker/Terraform executable: actual apply, health, real API job,
persistence restart, teardown and Terraform fmt/validate/test remain NOT_RUN. Source syntax
and fake-adapter checks do not establish these outcomes. Final QA TPR-150/152 must execute
the commands on the immutable integrated candidate in its assigned runtime environment.
Frontend integration needs the CTO route/navigation delta; UI compile and basic inspection
are distinct from the deferred independent browser/accessibility/security suite.
