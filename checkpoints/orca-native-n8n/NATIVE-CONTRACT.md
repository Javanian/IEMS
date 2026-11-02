# Native local n8n boundary, version 1

Stage A: **IMPLEMENTED_NATIVE_INTEGRATION_PENDING**. Product **UNACCEPTED**; `fullEndpointCoverage=false`. No native kinds are admitted or registered by this stage. Stage B must implement the managed automation handlers, workflow/service credentials, SMTP binding and actual native probes. Existing `LOCAL_SIMULATED`, `local.engine` and local-delivery `PREVIEWED` semantics remain separate. Historical simulated or legacy records cannot be adopted into this boundary. `PREPARED` is a separate documentIntents recovery gate.

## Composition and trust

`initialize({client, db, ownedRunMarker, integrations:{effects:{mode:'NATIVE_LOCAL_N8N', nativeN8n:config}}})` creates `runtime.nativeN8nProvider` and registers adapter `native.n8n`. This mode does not register the four simulated adapters. `LOCAL_SIMULATED` continues to register precisely its original adapters. Stage B selects native kinds explicitly; presence of this adapter alone is not admission or native execution proof.

The async factory `createNativeN8nProvider(config)` is exported from `packages/tenant-lifecycle/native-n8n-provider.mjs`. Exact configuration:

```js
{
  client, db, ownedRunMarker, // Mongo client, its database, exact UUID ownedRun._id
  root,                     // absolute private runtime root
  instanceId,               // UUID stable for this owned n8n database across process restarts
  id: 'native.n8n',          // optional provider ID, default native.n8n
  n8nPackageRoot,            // existing pinned installation's node_modules/n8n; read-only
  webhookToken,             // private token, at least 32 characters; never in attempts/events
  evidenceClass: 'NATIVE_RUNTIME', // default; SYNTHETIC can never perform I/O or mint observations
  workflows: [{
    workflowId, workflowHash,
    inputNode: 'IEMS_NATIVE_INPUT',
    resultNode: 'IEMS_NATIVE_RESULT',
    webhookUrl: 'http://127.0.0.1:<owned-port>/webhook/<fixed-path>'
  }]
}
```

The database name must begin `portfolio_owned_` or `portfolio_test_`. Its exact `ownedRun._id` must match `ownedRunMarker`. `root/native-owner.json`, created by the trusted owner during runtime setup, must equal this object with no extra keys:

```js
{
  schema: 'IEMS_NATIVE_N8N_OWNER_V1', marker: ownedRunMarker, instanceId,
  databaseName: db.databaseName, n8nVersion: '1.121.3', evidenceClass: 'NATIVE_RUNTIME'
}
```

The factory and each observation/submission verify this marker. Resolved history paths must remain beneath the real owned root. Only loopback HTTP `/webhook/` endpoints are accepted; credentials in URLs, query strings, fragments and redirects are rejected. The installation must identify itself as n8n `1.121.3`; its installed Flatted parser decodes native history. No dependencies or caches are modified. Runtime requires Node with `node:sqlite` (verified locally with Node 24.19.0).

The owner marker binds configuration to private filesystem/Mongo resources; it is not an OS security boundary against a process with write access to those resources. Stage B must keep the root private and only let the owned n8n process and SMTP sink produce history. Never insert a manufactured execution row or receipt into a NATIVE_RUNTIME root. There is no history-reader callback, caller-supplied trusted result, public observation constructor or test bypass. The diagnostic parser returns unbranded data that `reconcile` rejects. Explicit `SYNTHETIC` factories exercise durable claims but refuse network I/O and return no observations even if files contain structurally valid fixture history.

## Exports and immutable inputs

Provider exports: `createNativeN8nProvider`, `isNativeN8nProvider`, `nativeN8nBinding`, `nativeN8nWorkflowHash`, `inspectNativeN8nHistory`, `verifiedNativeN8nObservation`. Adapter exports: `createNativeN8nEffectsAdapter({client,db,provider,id:'native.n8n'})` and `isNativeN8nAdapter`. Both factories return frozen, privately branded objects. Object spreading/cloning loses authority.

Provider members: `id`, `providerId` (same value), `instanceId`, random UUID `processEpoch`, `mode:'NATIVE_LOCAL_N8N'`, `evidenceClass`; `owns(client,db)`, `binding(attempt)`, `execute(attempt,payload,{authorize})`, `observe(attempt)`. The adapter's `instanceEpoch` is exactly `provider.processEpoch`. Recreate both together after restart; retain the stable instanceId, workflow bindings and original attempt identity.

Native handler kinds are reserved as `automation.native-engine` and `automation.native-delivery`, with owner namespace `automation_audit_logs`. Their immutable command plan must include:

```js
native: { providerId, instanceId, workflowId, workflowHash }
```

The handler's `prepare` must return exactly these nine fields; there are no additional private/body fields:

```js
{
  workflowId, workflowHash, sourceHash, approvalHash, payloadHash,
  recipientHash, contentHash, deliveryId, messageId
}
```

Business/binding hashes use `contentHash` from tenant-foundation. The inputHash remains the existing `effectHash(input)` convention. Native workflow/execution hashes use sorted-key canonical JSON SHA-256 that additionally accepts finite fractional JSON numbers, because n8n node typeVersion values include decimals; always use `nativeN8nWorkflowHash` for workflowHash. Native JSON hashing rejects cycles, depth above 64 and more than one million visited values. Hashes are lowercase SHA-256 hex. IDs use bounded alphanumeric/dot/underscore/colon/hyphen strings; scope/root/attempt/process identities are UUIDs. `deliveryId` and `messageId` are both null for the engine; engine phase is `EFFECT`. Delivery phase is exactly its deliveryId, and messageId is an immutable `<identifier@iems.local>` string. For an engine without recipients/content, use hashes of explicitly frozen empty descriptors, not absent fields.

The original provider key remains `contentHash({tenantId,commandId,phase,ordinal})`. `nativeN8nBinding(attempt,{providerId,instanceId})` returns:

```js
{
  schema:'IEMS_NATIVE_N8N_BINDING_V1', providerId, instanceId,
  tenantId, plantId, legalEntityId, commandId, attemptId, phase, ordinal,
  fence, epoch, adapterId, instanceEpoch, providerKey, inputHash,
  correlationId:providerKey,
  workflowId, workflowHash, sourceHash, approvalHash, payloadHash,
  recipientHash, contentHash, deliveryId, messageId
}
```

The binding retains the original process epoch even when a later process observes it. CorrelationId is a planned lookup key, never the actual execution ID. Native execution ID comes only from `execution_entity.id`.

`nativeN8nWorkflowHash(workflow)` hashes exactly `{id,name,nodes,connections,settings}`. This covers executable nodes, connections, parameters and credential references while tolerating n8n's final metadata timestamps. Nonempty pinData/staticData are rejected. Use this helper on the exact imported workflow revision and verify the resulting hash against actual execution history. Native workflow history has both an initial five-field projection and a later full workflow snapshot; never hash arbitrary export wrapper metadata as the revision.

## Submission and handler integration

The native handler's `invoke` returns the transient payload object only. It must not perform HTTP/SMTP I/O or call provider.execute itself. The adapter calls it after durable BEGIN, validates `contentHash(payload)===input.payloadHash`, reauthorizes in the dispatch transaction and performs one fixed webhook submission:

```js
POST /webhook/<configured-path>
Content-Type: application/json
x-iems-webhook-token: <private token>

{ iemsNative: <exact binding>, payload: <frozen payload> }
```

`execute` is an internal composition operation, not a public API route. It requires the original process epoch, a durable BEGUN attempt with matching binding, and current authorization. The atomic `provider.dispatched` claim plus tenant fence commits before HTTP. A second call, stale process or closed epoch cannot submit. The configured webhook remains fixed, redirects are disabled, and the existing 30-second request budget is used. Neither ACK body nor status establishes terminal proof. A crash after either durable crossing leaves uncertainty; no automatic resend is authorized.

Stage B must register the kind's original actor/service rebind, prepare/source validation, `beforeInvoke`, authorized publication, parent-child whitelist and read-status hooks. Reuse original root acceptance/key/body/usage receipt; native child continuation never creates a second billable root. Recovery of an existing unknown child must observe the original attempt, not create a new phase or ordinal. Keep service credential, Origin/JSON, selection, current actor/approval/source/recipient fences. Native engine publication source conflicts use `ENGINE_RUN_SOURCE_CHANGED`; delivery uses `STALE_DELIVERY_FENCE`, preserving private late proof and `PUBLICATION_DENIED` through the existing effects path.

No kind-level `observe` callback is needed: native adapters call their fixed provider reader through `refresh`. Native observation does not fall back to kind-level callbacks. `adapter.reconcile` accepts only an observation privately branded by that exact provider instance and matching original binding. Synthetic/foreign/cloned results are rejected.

## Native history and local mail

Reader paths are fixed beneath root:

- `n8n-user/.n8n/database.sqlite`, SQLite read-only connection with query_only and a read transaction.
- `smtp/receipts.ndjson`, fsynced actual SMTP sink journal, required for delivery.

The reader joins `execution_entity` and `execution_data` on executionId, decodes Flatted `data` and JSON `workflowData`, and searches the named input node for the exact correlationId. It requires exactly one correlated execution, then validates the entire binding, payload hash, workflow revision, `mode=webhook`, successful/finished/stopped execution, no deletedAt/retryOf/retrySuccessId/error, one successful input task/item and one successful final task/item. The final executed node must be resultNode. Error, empty/missing/pruned/corrupt history or duplicated correlation remains UNKNOWN. Observation performs no native-history writes.

The result node must emit exactly this object under `json.iemsNativeResult`:

```js
{ schema:'IEMS_NATIVE_N8N_RESULT_V1', bindingHash:contentHash(iemsNative),
  state:'COMPLETED', resultHash:<hash of the workflow's actual terminal result>,
  smtpReceiptId:null|<actual local SMTP acceptance UUID> }
```

The reviewed workflow must compute resultHash from its real result, not from a caller assertion, and must not have later asynchronous side effects, untracked children or automatic replay/send retries. smtpReceiptId is null for an engine and is the actual sink acceptance UUID for a delivery, extracted from the SMTP response `250 ... queued as <id>` and propagated through the native result node; it must equal the journal receipt ID. The reader verifies the stored final result node and hashes the entire execution record; it cannot make an arbitrary workflow's business logic trustworthy. Stage B's source review and native probes must establish this workflow behavior.

For delivery, actual SMTP headers must include:

```text
x-iems-native-correlation: <original correlationId>
x-iems-native-binding: <contentHash(exact binding)>
message-id: <exact frozen messageId>
```

The sink journal retains its existing actual DATA receipt structure: `id`, `receivedAt`, `envelopeFrom`, `envelopeTo`, `subject`, `body`, `raw`, `headers`, `receiptStatus:'Accepted by local mail sink'`. Exactly one correlated receipt is required. Sender and sole recipient must be synthetic `@iems.local`; `recipientHash=contentHash(envelopeTo)`, `contentHash=contentHash({subject,body})` refer to the exact persisted wire content. Stage B must make its rendered payload agree with this canonical form, including SMTP line endings, and must preserve the explicit message ID. These fields are currently absent from legacy bindings; old receipts are not proof for new native attempts. A receipt means `ACCEPTED_LOCAL`, not delivery to a customer.

Provider.observe returns null on uncertainty, otherwise an opaque frozen object with authority held in a private WeakMap. Only `verifiedNativeN8nObservation` can unwrap it for its original provider/attempt. Sanitized proof shape:

```js
{ mode:'NATIVE_LOCAL_N8N', providerId, instanceId, bindingHash,
  receiptId:`n8n:${instanceId}:${actualExecutionId}`,
  result:{ state:'TERMINAL', executionId, workflowId, workflowHash,
    executionHash, resultHash, deliveryState:null|'ACCEPTED_LOCAL',
    smtp:null|{receiptId,receiptHash,rawHash} } }
```

Only IDs/hashes/statuses persist in the four orchestration collections. Payloads, tokens, actual message text and raw native history remain private in the owned runtime root. The read is bounded to 10,000 execution rows, 16 MiB of serialized execution/workflow data and a 16 MiB SMTP journal; exceeding bounds fails closed as UNKNOWN, never a partial terminal proof. Stage B must retain the exact original execution/receipt for reconciliation and keep the owned probe within these limits.

## Stop, restart, publication and tests

Close the durable effects dispatch gate first using the existing transactional close operation. `stopAndDrain` then observes every begun native attempt, cancels only original-fence attempts without BEGIN in a transaction and builds a barrier over tenant/adapter/provider instance/current process epoch/stop epoch/high-water plus the exact attempt/receipt set. Any unresolved BEGIN returns PENDING. A new process does not inherit an old barrier; it must reconcile and build a new one. There is no promise-count shortcut, inferred NOT_PERFORMED after timeout, lease-based resend or provider-error success.

The effects layer independently rechecks owner, actor/service/source and publication authority. A late exact private receipt can survive revocation without authorizing a business update. Current native fixtures deliberately cannot mint terminal observations, so native terminal settlement and post-send revocation with actual SMTP remain stage-B runtime gates. Existing shared effects/engine/delivery regressions cover local publication denial and exactly-once root usage without reclassifying them as native.

Stage B must demonstrate the original API root to actual n8n execution to actual local SMTP receipt, ACK loss, API/provider and n8n restart, duplicate/racing recovery, prune/contradiction rejection, source/revoke before and after crossing, read-only status, exact barrier, original receipt/usage identity and full cleanup. No native result is claimed by stage A. After B source is complete, stage C reviews regenerated source pins and contract metadata before native acceptance probes.
