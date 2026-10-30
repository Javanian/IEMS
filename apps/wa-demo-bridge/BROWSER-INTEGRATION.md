# Browser integration and UNKNOWN reconciliation

PLAT-047 local lifecycle and policy adapters are implemented; the concrete browser
driver is not implemented. `main.mjs` remains preview-only and refuses live mode.
No browser process or provider account was used for this handoff.

## Local integration still required

The integration owner must provide the host mount, trusted account/tenant/plant
mapping, foundation roles, source verifier and explicit initialization of the
session, authority and command indexes. These are implementation obligations,
not external dependencies. Operator HTTP and callback HTTP have distinct trust
boundaries; mount each exact route before a JSON parser. Do not mount lifecycle
or dispatcher ports as public endpoints.

The driver implementation must accept the immutable metadata passed by
`createProviderBrowserAdapter`, isolate each account's browser profile, and
return a close handle only after launch is confirmed. Closing must confirm
`{ closed: true }` only after that exact browser has stopped. Do not install
ready handlers, dispatch callbacks, automatic reconnect or automatic takeover.
The injected driver is trusted application code, not a sandbox.

## External boundary

Real account authentication, credential/session material, provider access and
authorization for real messaging are external dependencies. No credential is
requested or stored by this adapter. A real browser/provider run needs an
explicit scoped access decision and independent final QA. That boundary does
not excuse completing the local concrete driver implementation. Until then,
PLAT-047 remains IMPLEMENTATION_REQUIRED with live acceptance EXTERNAL_DEPENDENCY.
External send remains disabled even when policy metadata is configured.

## UNKNOWN procedure

1. Stop issuing start/stop calls for the affected account. A timeout does not
   cancel launch or close; the browser may still be running.
2. Read the adapter's `status()` from the trusted host and the durable session
   record. Status includes tenantId, accountId, ownerId, generation and state;
   it contains no profile path, cookies, credentials or message content. Do not
   expose this diagnostic through an unauthenticated endpoint.
3. Match the exact owner/generation to host process evidence. Process ID alone
   is insufficient after reuse. Late promise completion does not clear UNKNOWN.
4. An authorized operator must establish that the exact browser is stopped
   before using the registry's explicit release contract. Never set
   `adapterClosed: true` merely because a timeout elapsed. If evidence is missing,
   preserve the reservation; do not acquire a replacement or resend.
5. The in-memory adapter has no reset method. After reconciliation, use a new
   host lifecycle instance and a fresh durable generation. Restarting the host
   alone does not prove that a prior browser exited.

The current adapter does not retain a late browser handle for automated cleanup.
Host-level process reconciliation is therefore required after uncertain launch.
Final QA must cover real launch/close, crash recovery, account isolation, late
completion, authenticated mounts and actual index/concurrency enforcement.
Contract-double checks do not establish those results.
