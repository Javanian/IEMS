# Reproduce the rejected permit experiment

Run from repository root with Node24, six actual locked installs and an exclusive heavy slot: at least2GiB available RAM and no existing Mongo test process. Set IEMS_QA_EVIDENCE to a fresh external directory, MONGOMS_VERSION=7.0.14 and MONGOMS_DISABLE_POSTINSTALL=1. Optional MONGOMS_SYSTEM_BINARY selects an existing cached7.0.14 executable.

```text
node --test --test-concurrency=1 --test-reporter=tap checkpoints/p2-f5a-dispatch-followup/f5a/owner.test.mjs checkpoints/p2-f5a-dispatch-followup/qa/f5a-authorization.test.mjs
```

The two files report41 entries in one invocation: owner11 plus independent30. A passing expected-counterexample suite means the candidate remains REJECTED. The prototype must never be registered in the application. Clean checkout defaults resolve the real project and sibling candidate; external authoring overrides are not required. The independent test pins the prototype's raw SHA and refuses overwriting its JSON report.

The fixture creates only its own marked disposable replica/database and removes it afterward. Do not use production credentials or weaken ownership/resource checks. Keep complete TAP, independent-f5a-results.json and source/command associations external. See ../F5A-VERDICT.md for the decision and limits; no benchmark or production readiness is implied.
