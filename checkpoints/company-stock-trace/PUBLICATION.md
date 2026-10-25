# Publication boundary

Base commit is `9ad677a3fabedbe2005cdb2fefbc8d0e7d8ee140` on `feat/company-stock-use`, with [draft PR13](https://github.com/Javanian/IEMS/pull/13) still open and unmerged when checked for this increment. New development is isolated on `feat/company-stock-trace`. Fourteen older worktrees and the original dated master-plan sources have before snapshots outside Git.

The local gates and source/import closure must pass before the checkpoint commit and ordinary push. Commit text describes the functional change briefly. No merge, force push, history rewrite, deployment or production-data migration is part of publication.

Final immutable commit identity, current-head checks and run links are attested in the stacked draft PR and external publication evidence. This file intentionally does not embed a future self-referential commit hash or call pending CI green. A same-head CI failure must retain its failure disposition even if a later attempt passes.

The workflow now retains synthetic browser JSON/screenshots for seven days even after failure and prints collected network failures in failure stdout. This improves future observability. It does not establish a cause or a fix for the parent's historical browser reload failure.

Raw TAP/logs, screenshots, PDFs and database files remain outside the commit. The source auditor includes the new checkpoint and every literal relative import in its scoped source manifest. A separate changed-content inspection checks raw-file and selected credential patterns; it is not a full history, entropy or personal-data certification.
