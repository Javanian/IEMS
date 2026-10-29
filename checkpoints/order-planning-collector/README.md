# Bounded Windows loopback collector

This diagnostic prototype samples IPv4 loopback TCP tables and queries process creation identity. It does not trace payloads or identify kernel allocation owners. Read COLLECTOR-CONTRACT.md and QUALIFICATION-PLAN.md before use; a successful synthetic qualification is separate from application acceptance.

From repository root on Windows with Python3.11+ and Node:

    python -m unittest discover -s checkpoints/order-planning-collector -p test_collector.py -v
    python checkpoints/order-planning-collector/qualify.py --directory C:/task-evidence/new-unique-trial
    python checkpoints/order-planning-collector/parser.py C:/task-evidence/new-unique-trial/block-1-on/collector

The destination trial must not exist. Artifacts and all failed trials remain. The collector CLI accepts run/stop, a new owned directory and matching unique token; duration<=120s, samples<=8MiB, interval100ms..1s. Repeated start on the same live identity and token reports ALREADY_RUNNING; repeated stop is safe. Do not reuse a completed directory. Stop latency is measured by the parent from request through process exit; summaryPreparationMs is only serialization preparation.

Qualification invokes only owned loopback server/client processes, no credentials or payload, no resource exhaustion. A closed listener may yield bounded TimeoutError or ConnectionRefusedError; neither is a reproduced10055. Automatic push/PR checks remain mandatory; the dedicated push qualification job is separate from full Portfolio CI and controlled full-workload diagnostic budgets. Repo path is deliberately outside ignored /tools and uses a dedicated tracked checkpoint directory.

Threshold revisions and local failed trials are disclosed in plan. Missing telemetry makes diagnosis inconclusive. Forced VM termination cleanup is unverified. No ETW session is created.
