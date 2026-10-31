# PLAT-046 integration delta

Source: accepted n8n candidate `f5530eea5b4268f1852282b97228b0b45e0b12f5`,
selected files only. No old app, shared routing, source adapter or tests replaced.
The runtime/workflows retain the accepted pinned local n8n package and credential
references. Credentials and live services have not been provisioned by this work.

CTO owns these shared registrations in TPR-149:

1. Import `automationRoles`, `automationActions`, `initializeAutomation` and
   `installAutomation` from `apps/portfolio-api/src/automation.mjs`. Merge role
   actions before creating foundation. Add actions to the owner role once.
2. Pass the explicit `automation` options through initialize into runtime, call
   `initializeAutomation(db)` before enabling routes, and call
   `installAutomation(app, runtime, {fail,id,fields})` after session authentication
   and CS scope middleware, before the final 404 handler.
3. Adopt only the scoped automation service authentication hunks from the accepted
   candidate's app.mjs. Restrict Bearer credentials to `/api/cs/automation/`, require
   sessions.automationService, authenticate through foundation, and reject service
   sessions on cookie/unrelated routes. Retain current Origin/JSON/CSRF guards for
   human mutations; the narrow service exception still rejects cross-site requests.
   Do not replace the current app wholesale. Human approval remains mandatory.
4. Mount exported `AutomationCenterWorkspace` at `/portfolio/service/automation`
   with `cs.automation.read` permission, using the existing workspace shell. Add
   its permission-aware navigation only when the real route is mounted.
5. Configure loopback n8n/sink endpoints and separately provision scoped service,
   webhook and sink credentials outside Git. `lab-runtime.mjs` requires these app
   registrations before use. Starting it before integration is NOT supported.

The feature emits no order/quantity/money reporting snapshots. Ticket escalation
metadata stays in its scoped audit; private drafts, message bodies and internal
notes are excluded from reporting. Customer service remains independent of n8n.

Local transport is limited to synthetic `@iems.local` mail. RECEIPT/engine HTTP
redirects are refused. FAILED work has at most three known-unsent attempts;
UNKNOWN is receipt-reconciled or manually reviewed and is never automatically
resent. Local SMTP acceptance is not actual customer delivery. External send
remains disabled. No provider/cloud/live acceptance is claimed.

Independent runtime, transaction rollback/revocation, browser and workflow QA
remain with TPR-150/152 after the integrated immutable candidate exists.
