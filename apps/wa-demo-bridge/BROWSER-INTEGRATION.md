# Browser integration and UNKNOWN reconciliation

PLAT-047 local lifecycle, policy adapters and the concrete local blank-browser driver
are implemented. `main.mjs` remains preview-only and refuses live mode. The bounded
local smoke opens and closes installed Chromium without a provider account. This
is not WhatsApp login, inbound collection or live acceptance.

## Local integration still required

The integration owner must provide the host mount, trusted account/tenant/plant
mapping, foundation roles, source verifier and explicit initialization of the
session, authority and command indexes. These are implementation obligations,
not external dependencies. Operator HTTP and callback HTTP have distinct trust
boundaries; mount each exact route before a JSON parser. Do not mount lifecycle
or dispatcher ports as public endpoints.

The concrete driver accepts the immutable metadata passed by
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
not excuse completing the local concrete driver implementation. The local driver has no provider navigation or message port; real provider authentication, inbound integration and live acceptance remain EXTERNAL_DEPENDENCY. Local host composition is an integration obligation, not an external dependency.
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

## Concrete local driver and host composition

`createLocalBrowserLifecycle` in `src/local-browser-driver.mjs` accepts the durable
session registry, fixed owner/tenant/account, absolute installed Chromium executable,
and an explicit run-owned scratch root. Call start/stop from a trusted host only.
It uses createProviderBrowserLifecycle: acquire before launch, close confirmed by
process exit before release. Each launch creates a fresh unique profile and stores
only scoped ownership/process metadata in that scratch profile. No existing user
profile, cookie store, browser extension, external URL or executable arguments can
be supplied. The child receives a small OS environment allowlist. No API secrets
are inherited. The driver opens about:blank, disables background networking and
DNS resolution, and exposes no evaluate/navigation/ready/send method. These flags
are defense in depth, not a network sandbox guarantee.

The CDP socket binds loopback on an OS-assigned port. The driver reads Chromium's
DevToolsActivePort file and only sends Browser.getVersion and Browser.close. See
[CDP transport discovery](https://chromedevtools.github.io/devtools-protocol/) and
[Browser protocol](https://chromedevtools.github.io/devtools-protocol/tot/Browser/).
Do not forward that local diagnostic socket. Browser startup timeout/crash/close
ambiguity keeps the durable owner reservation. Driver status includes process ID,
profile ID and start time for exact host reconciliation; no profile paths or content.
Profiles remain in run scratch; never remove a profile while its browser is alive.

Bounded smoke (PowerShell, assigned workspace): set IEMS_LOCAL_BROWSER_EXE to an
absolute installed Chromium path; ensure PAPERCLIP_RUN_SCRATCH_DIR points to the
current run; then run `node --test apps/wa-demo-bridge/test/local-browser-driver.test.mjs`.
The real test is explicitly skipped when executable configuration is absent.
The registry in that smoke is a test double; durable Mongo fencing remains final QA.
No package/lockfile change, download or provider credential is required.
