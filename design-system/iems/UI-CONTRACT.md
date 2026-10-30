# Role workspace UI contract — PLAT-006

Status: implementation contract; independent acceptance belongs to final integrated QA.
Owner: Frontend UI, TPR-137. English UI. Apply `MASTER.md` and its page overrides.

## Direction and tokens

Keep the existing cool canvas (`--canvas`), white surface (`--surface`), navy navigation
(`--chrome`), blue actions (`--brand-600/700`) and ink (`--ink`). Bundled Plus Jakarta Sans
serves labels and headings; tabular numerals serve quantities. No external font requests.
Shared portfolio styles load through `portfolio.css` and `theme/workspace.css`.
Scoped workspace tokens expose muted text, borders, danger/success, spacing and control height.
Navy groups separate sales, supply, production, delivery and service work; they are navigation,
not a claim about the user's authority. Existing permission-specific links retain their checks.
The server and vertical controls remain responsible for authorization.

At 960px and above the workspace uses a 15rem navigation rail and a fluid content column.
Below 960px native Workspaces disclosure contains navigation; Work queue remains visible.
At tablet widths the disclosed groups use two columns; phone groups stack. No sticky overlay
covers content. Navigation changes close the disclosure and focus main content. Active links
use `aria-current="page"`; route guards and session API are unchanged.

## Components and inputs

Import components directly from their files under `apps/web/src/components`.
These components render supplied facts and do not fetch or mutate domain data.

| Component | Required input | Optional input / behavior |
| --- | --- | --- |
| `layout/RoleWorkspaceShell.jsx` | children | identity (existing session shape), kiosk, sessionActions; owns navigation presentation and focus |
| `layout/RecordShell.jsx` | title | reference, status, updatedAt (UTC ISO), nextAction (React node), relations, timeline, children |
| `ui/WorkspaceState.jsx` | title or children | kind: empty/loading/error/success; action: a real link/button; loading/success status, error alert |
| `forms/WorkspaceField.jsx` | label, name | native input props, hint, error, id; `as="select"` with children or `as="textarea"`; label/error/hint IDs generated uniquely |
| `tables/WorkspaceTable.jsx` | caption, columns, rows, rowKey(row) | loading, error (safe human-readable text), retry, empty |

Record relations are `{id, to, label, description?}`; use stable resource IDs and real routes.
Timeline entries are `{id, title, at?, description?, details?}` in the server's intended order.
`details` may contain permission-aware audit controls supplied by the vertical.
Do not invent history, completion, freshness, quantities or next actions. Empty arrays display
honest absence. Pass permission-aware links/actions from the vertical. RecordShell is used by
the existing opportunity page with actual stage, history, account relation and update time.
Existing `OperatorUi` record headings/workflow/audit controls remain compatible; do not replace
their permission-sensitive business behavior with a new domain implementation.

Table columns are `{key, label, numeric?, render?(row)}`. A stable rowKey is mandatory;
never use row index or formatted amounts as identity. Preserve exact decimal strings and
explicit units/currency in renderers. Cells may contain native links/buttons. Sorting/paging,
selection and API query state belong to the vertical. The named, focusable scroll region
contains a semantic table with caption and column headers; wide tables scroll inside it.

## State and accessibility rules

- Fetch owners abort or ignore stale results and unmount completions. Clear old records when
  scope changes; do not label retained values as freshly loaded. `Resource` retains its abort
  behavior and uses the shared loading state. Failure preserves diagnostic details and retry.
- Mutation owners keep immediate duplicate-submit locks, expected revisions, idempotency and
  uncertain-result handling. These presentation components never retry mutations automatically.
- Associate every label with its control; describe hints/errors with IDs. Focus the first invalid
  field or error summary after failed submission. Do not put the entire screen in a live region.
- Use text alongside status color, visible focus, at least 44px controls (48px kiosk), and an
  explanation for disabled actions. Preserve native Enter/Space behavior and reduced motion.
- Use `pf-table-wrap` for existing wide tables. New tables should use WorkspaceTable or the same
  labelled, keyboard-focusable region pattern. Avoid document-wide overflow or clipping.
- Loading, empty, failure and success are distinct. Empty content must explain the relevant next
  step where known. Retry controls must call a real read operation; never show a decorative CTA.

## Integration boundary

No manifest, package, global router registration or backend delta is needed for this feature.
Existing portfolio route tree and authentication are preserved. Vertical owners may import
these shared components; they own their API/state, safe domain text and permissions.
Build and basic shell inspection are implementation checks. Full browser/API/security,
visual/accessibility matrix and independent QA run only after program integration.
