# Quote catalog entitlement: bounded contract

Scope: optional `CATALOG_QUOTE_V1` on the existing commercial quote workflow. All lines in this cohort are explicitly bound; mixed bound/unbound lines are rejected. Existing legacy and inquiry-derived quotes remain unbound and cannot be retrofitted in this increment. This is commercial identity evidence, not stock reservation, allocation, execution, or dispatch authority. Typed sales orders are blocked from unsupported legacy material/fulfillment writers.

## Writes

Existing `POST /api/commercial/quotes` adds `schema: "CATALOG_QUOTE_V1"` and mandatory `idempotencyKey` (8..100 ASCII letters/digits/underscore/hyphen). Other top-level fields remain accountId, expiresAt, taxPolicy, roundingPolicy, lines.

Each typed input line has EXACTLY the five existing financial fields (`description`, `quantity`, `uom`, `unitPrice`, `currency`) plus `catalogItem: {itemId, itemVersion, itemRevision}`. IDs are UUIDs; versions/revisions positive safe integers. No caller snapshots, bindings, owner, provenance, hashes, or eligibility flags. Financial arithmetic remains exact. UOM must equal the master. SERIAL quantity must be integral (decimal spelling with zero fraction permitted). No inferred item identity.

Eligible masters are current APPROVED `INVENTORY_ITEM_V2`: PURCHASED with LOT or SERIAL, or MANUFACTURED with SERIAL; active current plant/legal entity owns the item. Older schema-unset manufactured revisions are deliberately unsupported; approval of a real V2 revision is required. Fresh create/revise/approve/accept/convert revalidates exact captured master version/revision/hash and writes its real useFence inside the guarded transaction.

`POST /quotes/:id/revisions` for an existing typed quote accepts schema CATALOG_QUOTE_V1, expectedVersion, expiresAt, lines, taxPolicy, roundingPolicy, optional unchanged accountId, idempotencyKey. Schema/cohort never changes. Maximum 50 quote revisions. Existing approve/accept/convert bodies add mandatory idempotencyKey for typed rows: expectedVersion, revision, idempotencyKey. Successful create201; all other200. Every typed command is durably keyed; same payload returns validated historical result after fresh authorization, without requiring the old item to remain current. Changed body under the same key409 IDEMPOTENCY_CONFLICT. Existing legacy conversion keys are reserved against every fresh typed command, preserving the original legacy conversion replay. Typed durable keys independently identify the cohort if the mutable quote marker is removed/relabelled. No new actions/implicit master grants; existing quote action is checked before replay.

## Stored / returned shape

Typed quote has schema CATALOG_QUOTE_V1 and ownerLegalEntityId. Each server-built revision also has schema and each line replaces catalogItem with:

`catalogBinding: {itemId, itemVersion, itemRevision, ownerLegalEntityId, code, contentHash, itemSnapshot}`

itemSnapshot is the immutable approved master head snapshot including `_id`, version, currentRevision, code, content, contentHash, authorityHash, approval, eventId, scope and owner; hidden useFence is excluded. Original commercial prose/quantities are preserved. Snapshot identity and the immutable inventory revision/event proof are validated historically, independent of the current head. Typed quote revisions/approval/acceptance and native SO snapshot have hash-bound semantic snapshots in append-only events and independently discoverable cohort evidence. Approval snapshot must equal the exact approved revision. Native SO copies the exact approved snapshot and carries schema CATALOG_SALES_ORDER_V1 plus ownerLegalEntityId and a hash-bound quote proof. No stock entitlement is inferred from legacy quotes.

Existing GET quote/order list/detail returns normal raw business fields plus `catalogEntitlement` ONLY for typed rows:

`{schema:"CATALOG_QUOTE_V1",historicalBound:true,stockDispatchAllowed:false,currentEligible:boolean,blockers:[{lineIndex,code}],lines:[{lineIndex,itemId,itemVersion,itemRevision,code,uom,kind,trackingPolicy}]}`

Current dependency drift is visible as QUOTE_ITEM_CHANGED; historical proof remains readable. Source corruption returns409 QUOTE_SOURCE_INVALID (including stripped/relabelled typed marker, mismatched quote approval/SO snapshot, missing/corrupt immutable source evidence). Event envelope recordedAt is diagnostic metadata outside the semantic hash; approval and acceptance actor/time are inside the bound business snapshot. No partial success/list truncation on invalid authority. Stored command results exclude derived current metadata; replay recalculates current metadata for the bindings in that returned historical result (not a later replacement quote revision) without mutating stored domain evidence; successful command replay still advances the existing transaction-bound authorization crmFence exactly once. Failed commands roll all such writes back.

## Options (quote.read; no master.read prerequisite)

`GET /api/commercial/catalog-items?q=&cursor=&limit=`. q optional case-insensitive CODE or DESCRIPTION prefix, max80 characters; default empty. limit default25,1..100; cursor strict UUID. Deterministic ascending UUID, usual `{data:[option],page:{limit,nextCursor}}`. Eligible supported current masters only. Indexed normalized prefix projection, atomically maintained by existing master writers; source authority revalidated on hydration. Projection inconsistency409 CATALOG_SEARCH_SOURCE_INVALID, no silent replacement.

`GET /api/commercial/catalog-items/:id` returns `{data:option}` even if currently ineligible; unknown/foreign404. Option is `{_id,code,version,currentRevision,content,ownerLegalEntityId,eligible,blockers:[string]}`. Fresh selectors preserve captured itemVersion/itemRevision; hydration never replaces a user's captured revision silently. Unsupported/inactive/not-approved option blocker QUOTE_ITEM_CHANGED. Corrupt master409 MASTER_SOURCE_INVALID.

## Errors / bounds / exclusions

Malformed UUID/version/body/line400 using existing INVALID_ID/INVALID_VERSION/UNKNOWN_FIELD/INVALID_LINE; INVALID_CATALOG_ITEM400 for malformed typed selector. Wrong UOM400 ITEM_UOM_MISMATCH; nonintegral SERIAL400 SERIAL_QUANTITY_REQUIRED. Fresh item withdrawal/revision mismatch409 QUOTE_ITEM_CHANGED; own/foreign identity404; scope403; revoked role403. Existing financial/state/expiry errors unchanged. Typed historical corruption409 QUOTE_SOURCE_INVALID. QUOTE_COHORT_CONFLICT400 rejects cohort upgrades/downgrades. CATALOG_ORDER_UNSUPPORTED409 blocks unsupported typed SO legacy mutations even after marker stripping. Revision51 or event budget overflow409 REVISION_CONFLICT. Reads are snapshot transactions and do not fence/write. Existing quotation PDF rendering remains financial-only: the document path validates catalog authority before rendering, but catalogBinding is not included in the renderer snapshot/PDF and that PDF is not a standalone catalog entitlement certificate. No dispatch, direct stock fulfillment, legacy retrofit, inquiry catalog mapping, inventory consumption, migration, or F5 authority optimization.

Collections: existing quotes/salesOrders/quoteConversions/commercialAudit/commercialOutbox, plus quoteCatalogEvents (unique scoped quoteId+version), quoteCatalogKeys (unique scoped key), quoteCatalogOrders (unique scoped orderId and quoteId). Existing inventoryItemRevisions/internalPlanningEvents remain historical source authority; catalogOptionSearch gains quoteEligible and a separate quote-prefix index. Independent typed proof lookup prevents marker stripping from downgrading the cohort.
