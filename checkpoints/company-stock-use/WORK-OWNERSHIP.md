# Ownership and verification order

All edits belong to the new company-stock-use worktree; thirteen earlier checkouts have before HEAD/status snapshots. Parent PR12 source and external evidence freezes remain unchanged.

| Owner | Files and responsibility |
| --- | --- |
| A domain | company-stock/state modules; internal-production and internal-execution/state; owner tests and fixture helpers. Publishes exact typed wire before UI/independent edits |
| B frontend | InternalProduction/Execution UI, new typed company picker/evidence, frontend behavior tests, new native supplemental browser helper. Existing V1 journeys/assertions retained |
| C independent QA | checkpoint qa files, supplemental actual HTTP fixtures, domain/source interleaving probes, independent reports. No production edits or weakened owner tests |
| Lead | CONTRACT/STATUS/backlog/reproduction/publication/acceptance, app module/role registration, source audit/manifest, workflow/ignore, integration, final verification and GitHub |

Heavy local work has one owner: installation/build, owned Mongo API/browser or benchmark. Other owners may read/write their files and run pure syntax/unit checks. Lead completed six actual locked dependency installations in the new worktree; no node_modules junction was used. No Mongo/build is authorized until its explicit token handoff. Marker-owned resources alone may be cleaned up; no user service or historical evidence file is stopped/modified.

Planned gates: frozen wire; owner API tests; independent API and ordering/rollback probes; frontend/build; connected native supplemental and unchanged parent journeys; final maintained API; publication/source closure/current-head CI. Reports are inputs to acceptance, not acceptance by themselves. F5 remains separately blocked.
