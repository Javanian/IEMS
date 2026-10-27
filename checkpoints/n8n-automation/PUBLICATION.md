# Publication verification

Keep PR19 in draft until the corrective acceptance matrix passes. Preserve earlier attestations as historical observations.

Regenerate the source manifest after source, tests, workflow exports and sanitized documentation are final:

```powershell
python checkpoints/wave4h/audit-publication.py --write
python checkpoints/wave4h/audit-publication.py
git diff --check
```

`--write` refreshes normalized SHA-256 values, retains all inherited entries, and adds automation source/tests/workflows/runbooks. It refuses to remove coverage when a listed file is absent. The default command audits hashes and relative imports without changing files. Neither command proves that a workflow executes in n8n.

The Portfolio acceptance workflow covers application regression and includes automation file changes in its path triggers. Local actual-engine/browser evidence is recorded separately; hosted application success must not be described as hosted n8n coverage.

Publish source, tests, sanitized exports, locked configuration and reproducibility instructions. Keep runtime databases, owner passwords, service tokens, encryption keys, logs and screenshots outside Git. Refresh remote head before a normal push; never force-push, merge or deploy as part of this task.

Publication acceptance is recorded in the dated PR19 attestation with the full immutable published SHA and each required check. This document describes the publication procedure, not live remote CI status.
