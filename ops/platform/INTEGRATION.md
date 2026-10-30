# Platform integration delta for CTO

Prerequisites incorporated: foundation `6dcf606e1b5ddbd7e97d8964415fe0f6aa8760a1`
(all ancestors), UI `04d0b28278b153939c3afefd36bf0ef4992223ca`. UI merge uses a local merge
commit; do not cherry-pick ancestor features twice. No shared manifest/lock/compose edited.

In app.mjs import `platformActions`, `platformRoles`, `initializePlatformRuntime`,
`installPlatform` from `./platform-runtime.mjs`. Add platformRoles to roleActions and
platformActions to roleActions.owner **before** createTenantFoundation. After commands
initialization set `runtime.platform = await initializePlatformRuntime(runtime, {roleActions,
handlers, actionForKind})`. Register `installPlatform(app,runtime)` after authenticated `/api`
middleware and before the error handler. Use existing origin/JSON/session middleware.

Handler map and required domain action map come from vertical owners; no arbitrary job
kind accepted. Do not map jobs to the local smoke handler in the application. Exported
worker and dispatcher use `runtime.platform.jobs`; inject amqplib connection into
createRabbitTransport. Dispatcher must run periodically with bounded batches. Close consumer,
publisher, connection and Mongo client on shutdown. No broker URL/password in frontend or logs.

Frontend route `/portfolio/platform` imports default PlatformWorkspace. It reads only the
authenticated current user's scoped jobs via `/api/platform/jobs`; gate navigation on
platform.read. Existing UI shell owns tokens and navigation. No global routing edit here.

No root dependency change required for API initializer: core packages use Node builtins and
injected Mongo objects. Owned worker/local image installs pinned amqplib and mongodb under
ops/platform. Redis adapter accepts an injected node-redis compatible sendCommand function.
If adding a shared worker entrypoint, CTO owns manifest/lock and app registration.
