# Automation Center corrective verification

Task `n8n-corrective-acceptance-20261027`, 27 October 2026. These are local observations; the final published revision and hosted CI are attested on [draft PR19](https://github.com/Javanian/IEMS/pull/19). This is not a production release.

## Actual engine and UI

Pinned n8n 1.121.3 imported the five sanitized executable specs. Independent read-only metadata checks matched their nodes, connections, settings and version IDs to the exports. The three business workflows ran through the real browser, n8n and authoritative APIs:

| Controlled execution | Observed result |
| --- | --- |
| SLA 10 | Internal escalation; ticket remained NEW and unassigned |
| Approved resolution 11 | Legitimately resolved ticket, separate human approval, immutable local email accepted |
| Digest 12 | Independent full scoped counts; genuine local receipt |
| Restart SLA 19 and recovery 20/21 | Core CS remained usable while n8n was stopped; pending work recovered; accepted receipts not repeated |
| Rejected resolution 22 | Expected engine error; no email |
| Error handler 23 | Successful sanitized failure recording |

These are seven successful controlled executions and one expected rejected execution. Background schedule runs are excluded from those acceptance counts. Numeric IDs describe this owned instance; a new instance generates its own IDs.

Independent browser campaign: 16/16 checks, 27 screenshots, no uncaught page errors or browser sink bypass. It exercised supported complaint creation, truthful source history, human resolution, approval, real engine delivery/digest, rejected/stale decisions, keyboard/focus, actionable failure/recovery and no page overflow at 360/768/1440. Two final presentation changes (Demo link spacing and execution-reference disclosures) received a separate 3/3 width and keyboard verification with 6 screenshots; business handlers were unchanged.

UNKNOWN coverage combines real SMTP with an injected post-submit failure in the API campaign. A separately labeled lost-acknowledgment state fixture reused a genuine accepted receipt for four browser checks at 360/768/1440: UNKNOWN/manual controls rendered, real reconciliation restored the same receipt, and the exact SMTP receipt set remained unchanged. This does not claim physical process kills at every SMTP boundary.

Independent actual stop/restart and clean-import campaign: 7/7 checks. A fresh n8n user folder imported exactly the five current specs through the pinned CLI; no second editor server was started. The main engine was actually stopped and restarted. No old accepted email was resent.

Full lab normal stop/start persistence: 8/8 comparison checks passed. The same 5 tickets, 9 drafts, 3 outbox records, 3 receipts, 5 workflow versions and all 35 prior execution references survived; background runs added four legitimate references. All six owned listeners closed during stop, and the user PostgreSQL PID and creation time remained unchanged. A stale command with the actual new PID and an old boot nonce was ignored; a valid current command was accepted.

## Application regression

- Full maintained API: 200/200, 0 skips, on a stable dirty snapshot before two final bounded fixes (fractional SLA occurrence keys and latest workflow observations).
- Affected API/helper/independent regression after those fixes: 47/47, 0 skips. This includes the independent 34-test suite and is not an additional unique total to add to 200. One later audit-label classification expression received syntax review; exact-head hosted regression remains required.
- Final frontend behavior: 44/44; API syntax and renderer public types passed.
- Renderer full attempt: 17/18; one owned Mongo startup exceeded its 10-second default during package extraction. The unchanged affected renderer file then passed 6/6 without skipped tests after load cleared. The original failure is retained; hosted CI runs the entire renderer suite.
- Private SMTP persistence: 4/4 Node tests, genuine SMTP, private inspection, no HTTP receipt fabrication, and receipt retention across sink restart.
- Final web build: PASS, exit 0 including PWA generation (final source); private log SHA-256 be54255ece680f28d19178b944b714510c24ead3f3333f7fa35d4a8ff1e1105b.

The JavaScript development helpers and their HTTP integration tests are not n8n execution tests. Local sink acceptance is not customer delivery. WhatsApp remains PREVIEWED. SLA compliance is explicitly unmeasured; it is not inferred from escalation/created ratios.

## Reproduce and audit

Use [the lab runbook](../../ops/automation-lab/README.md) for Node 24, locked dependencies, start/stop/status, credentials outside Git, supported synthetic seed and the 5–8 minute walkthrough. Use [CONTRACT.md](CONTRACT.md) for routes and trust boundaries.

Before publication, run `python checkpoints/wave4h/audit-publication.py --write`, then the default read-only audit. The manifest records normalized SHA-256 and import closure for source, tests, scripts and exports. The unsupported historical WhatsApp handoff export was intentionally retired; all five current workflows remain covered. No active audit/check was removed to make acceptance green.

Raw logs, screenshots, runtime databases and credentials remain outside Git. Failed baseline/API/bootstrap/browser-harness attempts are retained separately from final proof. Required hosted checks must pass on the exact published head; local evidence does not assert remote status or remote n8n coverage. PR20 and global F5 remain separate.
