# Corrective automation contract

Frozen for task `n8n-corrective-acceptance-20261027`; backend A, runtime/UI B, independent QA C, integration/publication lead. Source validation remains required.

## Identity and transport boundaries

Humans use the IEMS session and plant permissions. A human owner provisions a restricted token with `POST /api/cs/automation/service-credentials {label,ttlMinutes}`; the token is returned once and stored outside Git. n8n outgoing requests use an encrypted `httpHeaderAuth` credential named `IEMS scoped automation service`, fixed ID `iems-service-api`, header `Authorization: Bearer <token>`. n8n cannot approve/reject/cancel drafts or access unrelated business routes.

Webhook incoming authentication is a separate private credential `iems-webhook-auth`, header `x-iems-webhook-token`. The API proxies authorized human workflow requests and never forwards the human cookie to n8n. SMTP is submitted by IEMS after a durable intent; n8n does not invent/send receipt evidence. Sink inspection requires a separate private Bearer token, and browsers use the scoped IEMS proxy only.

## Routes and state

Prefix `/api/cs/automation`:

- GET `status`, `sla-breaches`, `digest`, `resolution-drafts`, `resolution-drafts/:id`, `audit-logs`, `deliveries`, `sink-messages`.
- POST `escalate {ticketId,expectedVersion,reason}` with stable occurrence key. Eligibility/version are rechecked at the writer. Escalation never assigns or starts work.
- POST `resolution-draft {ticketId,expectedTicketVersion,channel,recipient,proposedResolution}` for a legitimately RESOLVED ticket; channel EMAIL or SIMULATED. Creation/sending never resolves a ticket.
- POST `resolution-drafts/:id/{approve|reject|cancel} {expectedVersion}` by an authorized human. Approval binds immutable source/version/recipient/content/channel/expiry.
- POST `resolution-drafts/:id/dispatch {}` plus stable `resolution:<draftId>` key. Outcomes include ACCEPTED_LOCAL, PREVIEWED, FAILED, UNKNOWN. No request content/recipient override or caller receipt is accepted.
- POST `digest/dispatch {mode:'WEEKLY'|'DEMO',periodKey?}` with stable period/occurrence key and fixed synthetic recipient reports@iems.local.
- POST `reconcile {}` verifies durable sink receipts and expired leases. UNKNOWN is never automatically resent.
- POST `run/:workflowId {draftId?,periodKey?}` authenticates the human then calls the configured engine webhook. IDs: wf-sla-escalation, wf-cs-weekly-digest, wf-approved-resolution, wf-automation-recovery. Header `X-IEMS-Execution-Id` from outgoing engine calls provides audit correlation.
- POST `engine-error {executionId,workflowId,message}` records a sanitized local error reference without recursive notification.

Backend environment: `IEMS_AUTOMATION_N8N_URL=http://127.0.0.1:5687`, `IEMS_AUTOMATION_WEBHOOK_TOKEN`, `IEMS_AUTOMATION_SMTP_PORT=2527`, `IEMS_AUTOMATION_SINK_URL=http://127.0.0.1:8027`, `IEMS_AUTOMATION_SINK_TOKEN`.

## Engine and receipt

Pinned n8n 1.121.3 standalone, SQLite metadata outside Git, Bangkok timezone. Exported credentials contain IDs/names only. Workflow HTTP Request 4.2, Webhook 2, SplitOut 1, Set 3.4 and Schedule Trigger 1.2 parameters must be verified against the installed pinned node code and actual execution, not JSON parsing alone.

Webhooks are `/webhook/iems-sla-escalation`, `/webhook/iems-cs-weekly-digest`, `/webhook/iems-approved-resolution`, `/webhook/iems-automation-recovery`. SLA scans every minute; weekly digest Monday 08:00 Asia/Bangkok; recovery every minute. Manual digest has a distinct DEMO occurrence. Resolution dispatch runs only from an approved draft ID.

Sink accepts only synthetic `@iems.local` envelopes over SMTP. It appends/fsyncs JSONL before SMTP 250, retaining raw Message-ID and headers `x-iems-delivery-id`, `x-iems-tenant-id`, `x-iems-plant-id`, `x-iems-content-hash`. `GET /api/emails?messageId=...` requires the private sink Bearer. HTTP POST/DELETE cannot fabricate/erase receipts. The backend verifies exact task, scope, recipient, immutable content and message identity. `Accepted by local mail sink` is local transport acceptance, not customer delivery. SIMULATED remains PREVIEWED.

## UI design read

Preserve IEMS existing canvas/surface/chrome/brand token palette, Plus Jakarta Sans UI font, 44px controls and existing responsive navigation. Operational rows follow complaint -> approval -> receipt -> recovery. No decorative metrics or new dashboard identity; source ticket links and immutable approval content are the characteristic content. Existing panels, focus outlines and wrapping lists serve loading/error/empty/mobile states. Raw technical details are disclosure panels, not the primary operator action.
