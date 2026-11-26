# SAP staging jobs

These scripts turn timesheet and machine-hour records into payloads in `sap_timesheet_staging`, then post them to SAP.
Every script reads `.env` from the repository root.

> **This is the payroll path.** A mistake here means work hours that go missing, get counted twice, or land on the wrong person.
> Read **[Safeguards](#safeguards-do-not-remove)** and **[Dangerous limits](#dangerous-limits)**
> before changing anything.

---

## Flow

```
SQL Server --[ETL]--> mch_productiondata --[ETL]--> mch_transaction
                                  (+ mch_transaction_override)   |
                                                                 |
                       (eligibility gate) --> bundle per DAY --+--> NORMAL      --> sap_timesheet_staging (PENDING)
                                                               +--> CORRECTION  --> sap_timesheet_staging (PENDING, is_correction)
                                                                                         |
                       sap_staging_source (provenance per segment) <---------------------+
                                                                                         |
                                                 post_sap_staging.py --> SAP --> POSTED / FAILED / SKIPPED
```

- **NORMAL** is new work on a day that has not been closed yet. It posts automatically once the day is over.
- **CORRECTION** is hours that became complete **after** their day was already posted. They go into a separate bundle
  that does **not** auto-post; an admin sends it from the UI. SAP confirmations are **additive**, so a
  correction adds hours to the order. There is no reversal (storno).

---

## Eligibility rules (mch_transaction to staging)

A row is staged only when **all** of these hold:

| Condition | Why |
|---|---|
| `startdatetime` and `enddatetime` exist and `end > start` | valid duration |
| **`sn_employee` is set** | without it PERNR is empty, which means **hours with no owner** (operator gate, added 2026-07-14) |
| `statusid` is **not** 0, 3 or 4 | Off, Downtime and No Job are not work on an order |
| if `statusid` = 5, duration is **60 seconds or less** | a short Unidentified status is the gap between activities; long ones are not sent |
| **one of the two paths below** | productive **or** unproductive |

**The two eligibility paths:**

| Path | Extra condition | Needs `confirmation_number`? |
|---|---|---|
| **Productive** | `status_activitytype` in {M1, M2} **or** promotable idle (`statusid=2`, previous status 1, 300 s or less) | **Yes**. SAP needs RUECK to confirm an order |
| **Unproductive** | `status_activitytype` is set, is **not** M1/M2 and is **not** promotable idle | **No**. LSTAR without an order, so nothing is confirmed |

> **Do not use the `status_record` column as a gate.** Its definition has a back door
> (`statusid IN (0,3,4) OR ...`), so rows **without an operator still pass**.
> `status_record` measures data completeness for the `accuracy_machine` KPI. It is **not** SAP eligibility.
> (The two look similar, but they are different columns with different meanings.)

**Bundle duration filter:** after bundling, any bundle with `total_seconds < 60` is **dropped**,
because SAP rejects confirmations shorter than one minute. Several sub-minute records on the same day can
combine into one bundle that passes, but a bundle under one minute is never sent.

### `statusid` map (checked against real data; 3 and 4 are easy to mix up)

| id | Description | id | Description | id | Description |
|---|---|---|---|---|---|
| 0 | Off (excluded) | 6 | Load (M2) | 13 | Daily PM |
| 1 | Productive (M1) | 7 | Setting (M2) | 14 | Tool Preparation |
| 2 | Idle | 8 | Measure (M2) | 15 | Labour Necessity |
| **3** | **Downtime** (excluded) | 9 | Unload (M2) | 16 to 21 | Jig, Waiting, Wait... |
| **4** | **No Job** (excluded) | 11 | Breakdown | | |
| 5 | Unidentified (60 s or less only) | 12 | Coffee Break / Lunch | | |

---

## Payload shape

| Type | Condition | ZCONF_TYPE | RUECK | AUFNR/VORNR | LSTAR | ZBARCODEID |
|---|---|---|---|---|---|---|
| **Productive M1** | `status_activitytype = M1` | `M1` | set | set | empty | **`VA`** |
| **Productive M2** | `status_activitytype = M2` | `M2` | set | set | empty | status text (`Setting`, `Measure`, `Load`, `Unload`) |
| **Idle as M2** | `statusid=2` and `previoustatusid=1` and duration **300 s or less** | `M2` | set | set | empty | **`Idle`** |
| **Unproductive** | anything else | empty | empty | **empty** | activity type | empty |

**A short idle right after production is a micro-stop**, not wasted time, so it is treated as setup (M2).

AUFNR and VORNR are cleared **in the bundling key too**, not only in the payload. If they were cleared only in the
payload, two bundles that differ only by order would produce **identical payloads** and SAP would accept both.

**The times sent to SAP are synthetic:** `ISDD/ISDZ` is anchored to the **earliest real start**
of that day (`source_min_start`), and `IEDD/IEDZ` is that anchor plus the total duration. The **duration** is
accurate; the time window is not.

---

## Bundling per day

One staging row is one bundle of **(day, operator, order, operation, machine, activity type)**.
A `mch_transaction` row that crosses midnight is **split per day** (an event from 23:40 to 00:20 becomes 2 segments).

> Bundling used to be **per hour**; it is now **per day**. Hourly bundling dropped records
> that stayed under one minute in each hour even when the daily total was over one minute. With daily bundles,
> sub-minute records from different hours combine and pass the 60-second filter.

`norm_key = md5(werks | day_bucket | employee | rueck | aufnr | vornr | flgat | plnfl |
vornr_b | vornr_r | zconf_type | arbpl | lstar | zbarcodeid)`

- **NORMAL**: `source_key = norm_key`, `is_correction = false`.
- **CORRECTION**: `source_key = md5(norm_key | '|KOREKSI|' | seg_hash)`, `is_correction = true`
  (a different key, so a correction never collides with the normal bundle for the same day). The literal
  `KOREKSI` is part of the stored key and must not be translated.

> **Changing the md5 recipe re-keys the entire history.** See [Safeguards](#safeguards-do-not-remove).

---

## Normal vs correction (routed per day)

The route depends on **whether the day already has a POSTED bundle**:

| Day state | Mode | Goes to | Auto-post? |
|---|---|---|---|
| No POSTED bundle yet (day open) | **NORMAL** | PENDING, `is_correction=false` | **Yes**, once the day is over (`bucket_start < today`) |
| At least one POSTED bundle (day closed), record has no provenance | **CORRECTION** | PENDING, `is_correction=true` | **No**. An admin sends it from the UI |

Why per day and not per key: as soon as **one** bundle for a day is posted, that day counts as
closed. New or repaired records for that day (an operator or order that was never posted) become
**corrections**, so they land in a review queue instead of quietly auto-posting into a day that was already reported.

**Finished-day guard (in the poster):** the auto-poster only claims MCH_HOURS bundles with
`bucket_start::date < today` (Asia/Makassar). A day that is still growing must not be locked.
Use `--include-today` to override by hand.

**The auto-poster skips corrections:** `claim_rows` filters on `is_correction = false`. Corrections are
sent only through `--ids` (the **Post selected** button in the UI, which becomes the `post_corrections` action in ops_worker).

---

## Tables

| Table | Contents |
|---|---|
| `sap_timesheet_staging` | Payload queue. `ztimesheetid` = `id::text` (GENERATED). `is_productive` = `zconf_type IN (M1,M2)` (GENERATED). **`is_correction`** marks correction bundles (no auto-post) |
| **`sap_staging_source`** | **Provenance**: which source records a bundle came from (segment: `source_row_id` + `bucket_start` + seconds). Every safeguard hangs off this table |
| **`mch_transaction_override`** | Manual admin fixes (job or operator) that the ETL applies when it derives `mch_transaction` |
| **`sap_ops_request`** | Queue of UI button actions (`stage_catchup`, `retry_failed`, `post_corrections`). Consumed by `ops_worker.py` |
| **`sap_source_change_blocked`** | Log of attempts to change a record that was already sent to SAP (rejected by the freeze trigger) |
| `sap_stage_cursor` | Last position of the staging job |
| `sap_staging_eligibility_audit` | Why a source row is not eligible yet |
| `log_timesheet_sap` | Audit of every request sent to SAP (used by the burned-ZTIMESHEETID guard) |

---

## Scripts

| Script | Purpose |
|---|---|
| `stage_machinehours.py` | Scheduled machine-hours job (cursor) plus **catch-up**, which runs both NORMAL **and** CORRECTION mode |
| `stage_timesheet_transaction.py` | Scheduled operator timesheet job (cursor) |
| `stage_sap_timesheet.py` | Bundling engine and manual tool (init-db, ad-hoc staging). It holds the bundling SQL, so **every rule above lives here**. `mode="normal"` or `mode="correction"` |
| **`rebuild_machinehours.py`** | **Rebuilds the queue** after the payload shape or a rule changes |
| **`backfill_operator.py`** | Refills `operatorid` on old records from `usernfc` (`--emp_sn`, `--all`, `--since`, `--dry-run`) |
| `post_sap_staging.py` | Sends payloads to SAP (parallel, guarded, finished-day guard) |
| **`ops_worker.py`** | **Consumer of the `sap_ops_request` queue**. Runs the scripts above when a UI button files a request |
| `sap_staging_common.py` | Helpers: connections, DDL, staging plus provenance inserts, payload builder, cursor |
| `seed_sap_staging_manual.py` | Seeds a manual payload for testing |

---

## What runs on its own and what needs a trigger

> In short: **bundling and posting of finished days run automatically**; **corrections are always manual** (admin review).

### Automatic (compose services, no one has to touch them)

| Compose service | Runs | Job |
|---|---|---|
| ETL (`docker-compose.etl.yml`) | `etl_mch_transaction_v3.py` | Derives `mch_transaction` and applies `mch_transaction_override` |
| `sap-stage-worker` | `stage_machinehours.py --catchup` in a loop | NORMAL and CORRECTION bundling |
| `sap-post-worker` | `post_sap_staging.py` in a loop | Auto-posts PENDING **non-correction** rows, **finished days only** |
| `sap-ops-worker` | `ops_worker.py --loop` | Consumes the UI button queue (see below) |

Automatic order, repeated every interval:

```
ETL  ->  sap-stage-worker (bundling)  ->  sap-post-worker (post finished days)
                                          +- CORRECTION rows are skipped and wait for an admin
```

Intervals in `.env` (optional): `SAP_STAGE_INTERVAL` (900s), `SAP_POST_INTERVAL` (1800s),
`SAP_POST_LIMIT` (500), `SAP_POST_WORKERS` (5), `SAP_OPS_INTERVAL` (10s).

### Manual (UI button, then queue, then ops_worker)

`ops_worker.py` is **not** a scheduler and does **not** bundle anything itself. It waits for rows in
`sap_ops_request`, which the API writes when a button is pressed (Node cannot run the Python scripts directly),
then runs the mapped script:

| UI button (SAP log page) | Queue action | Command ops_worker runs |
|---|---|---|
| **Stage edited records** | `stage_catchup` | `stage_machinehours.py --catchup` |
| **Post selected** (Corrections tab) | `post_corrections` | `post_sap_staging.py --ids <...> --workers 3` |
| **Retry failed** | `retry_failed` | `post_sap_staging.py --failed-only` |

Correction flow from the UI, in order:

```
1. Admin edits a record in the Operator Hours tab (assigns job or operator)  -> writes mch_transaction_override
2. ETL re-derives mch_transaction (on its next run)
3. Click "Stage edited records"  -> ops_worker: stage_catchup  -> records on closed days become CORRECTION bundles
4. Open the Corrections tab, review, tick, "Post selected"  -> ops_worker: post_corrections -> SAP
```

---

## Commands (direct CLI, for operators and debugging)

### Scheduled staging and catch-up
```bash
cd jobs/sap_staging
python stage_machinehours.py                              # last hour + automatic catch-up (14 days)
python stage_machinehours.py --catchup                    # catch-up ONLY (NORMAL + CORRECTION)
python stage_machinehours.py --catchup --catchup-days 20
python stage_machinehours.py --dry-run
python stage_machinehours.py --from-ts 2026-07-01T00:00:00 --to-ts 2026-07-02T00:00:00
```
Catch-up looks for **eligible** records that **have no provenance yet**, so it cannot skip anything.

**Automatic floor:** catch-up never touches dates before the earliest bucket in the queue.
Without that floor it would find old data that **was sent to SAP before provenance existed** and
send it again. Override `--catchup-since` **only** if you understand the consequences.

### Rebuild after a rule or payload change
```bash
python rebuild_machinehours.py --from 2026-07-01 --to 2026-07-17 --dry-run
python rebuild_machinehours.py --from 2026-07-01 --to 2026-07-17
python rebuild_machinehours.py --full-reset --from 2026-07-01 --to 2026-07-17   # deletes EVERYTHING, ID back to 1
```
It deletes rows that were **not sent yet** and stages them again with the current rules. **POSTED rows and their
provenance are never touched**: they are the memory that prevents double posting.
`--full-reset` is **only valid once EVERY POSTED row has been reversed (storno) in SAP.**

### Posting
```bash
python post_sap_staging.py --limit 500 --workers 5           # auto-post: PENDING non-correction, finished days
python post_sap_staging.py --failed-only --limit 200         # "Retry failed" button: FAILED rows only
python post_sap_staging.py --ids 123,124 --workers 3         # "Post selected" button: specific corrections
python post_sap_staging.py --include-today --limit 500       # include the current day (careful)
python post_sap_staging.py --productive-only --limit 1200 --workers 5   # while SAP rejects unproductive rows
```

| Flag | Use |
|---|---|
| `--workers N` | Parallel requests. **Parallel across orders, serial within an order** (SAP locks the order). Start with 4 or 5 |
| `--failed-only` | FAILED rows only, PENDING untouched ("Retry failed" button) |
| `--include-today` | Include MCH_HOURS bundles for the current day (default: finished days only) |
| `--ids` / `--ztimesheetids` | Send specific rows (corrections through "Post selected") |
| `--productive-only` / `--unproductive-only` | Filter on `is_productive` |
| `--retry-failed` | Include FAILED **together with** PENDING in one run |
| `--max-retries` (3) | Retries **network failures** and **order locks**, never business rejections |
| `--retry-backoff` (2.0) | Base delay between retries (grows linearly) |
| `--delay-ms` (100) | Per-worker throttle. Raise it if CPI drops connections |

**Performance:** 13.2 s per row went down to **1.7 s per row** after (a) reusing one DB connection per thread
and (b) posting in parallel per order. **Run it on the server, not from a laptop**: the DB round trip is about 5 ms on the server
and 2,622 ms through a Tailscale tunnel.

### Operator backfill (old records with no operatorid)
```bash
python backfill_operator.py --dry-run --all
python backfill_operator.py --emp_sn 0123456789          # one operator
python backfill_operator.py --since 2026-07-01 --all
```

---

## Deploying the pipeline services

They are part of the main stack (`timesheet-network` and `DB_HOST=pgbouncer`, the same as `api`), so the
workers see the queue the application writes:

```bash
# if you used a separate compose file before, remove the old containers first:
docker rm -f sap-stage-worker sap-post-worker sap-ops-worker 2>/dev/null

docker compose up -d --build sap-stage-worker sap-post-worker sap-ops-worker
docker logs sap-ops-worker --tail 20   # look for "ops_worker target DB: host=pgbouncer ..."
```

The scripts are mounted (`./jobs/sap_staging:/app`), so a code change only needs `git pull` and a container
restart (the loop starts each script as a fresh process, so it picks up new code). Rebuild the image
(`--build`) only when `requirements` or the Dockerfile change.

---

## Kafka transport (optional)

Besides direct mode (`sap-post-worker`), posting can go through Kafka. Full details:
[`jobs/messaging/README.md`](../messaging/README.md).

```
PENDING/FAILED --sap_kafka_relay.py--> QUEUED --> sap.confirmations.v1 (key = AUFNR)
                                                   |
                       sap_kafka_poster.py: QUEUED -> POSTING -> guard -> post_one -> SAP
```

- `SAP_TRANSPORT=kafka` makes `ops_worker.py` run `sap_kafka_relay.py` (same flags as
  `post_sap_staging.py`) for every posting button in the UI.
- The message key is AUFNR, so one order always lands on one partition: **serial within an order, parallel
  across orders**, with no locking code. Add poster replicas for more parallelism.
- A message carries only `staging_id` and a payload hash. The poster reads the row again and only
  sends it if it is still `QUEUED` with the same hash. Duplicate or late messages are dropped.
- The new `QUEUED` status (migration `20261012_sap_staging_kafka_queue.sql`) is ignored by the
  polling poster, is removed by the invalidation trigger like PENDING, and goes back to its previous status if
  the broker does not acknowledge it or it waits too long.
- Every safeguard below still applies: the relay runs the guards when it claims a row, and the poster runs them
  again right before sending.

---

## Safeguards (do not remove)

### The trap behind all of them

`ZTIMESHEETID = sap_timesheet_staging.id::text`. It is **a row number, not something derived from the source data.**
SAP rejects a duplicate ZTIMESHEETID, **but that does not protect us**. As soon as `source_key` changes,
either because of **code** (the md5 recipe changes, `PLANT_CODE` is renamed) or because of **data** (an order_no is fixed),
a **new** staging row appears, with a new `id` and a new ZTIMESHEETID. **SAP accepts it as a new
confirmation** and the hours go in **twice**.

**The right anchor is the SEGMENT `(proddataid, bucket_start)`**, which does not change when the md5 recipe,
format or plant changes. `proddataid` alone is not enough: bundling splits records that cross midnight, so one
proddataid can **legitimately** appear in several bundles (segments).

### Layers

| # | Safeguard | Where |
|---|---|---|
| 1 | **Partial unique index** `WHERE posted_at IS NOT NULL`: one segment **cannot** be POSTED twice. The database refuses it, not human discipline | `sap_staging_source` |
| 2 | **Poster guard**: before sending, is the segment already POSTED? Same `source_key` means skip (a re-run). A **different** one is a **CONFLICT**: `SKIPPED` with "needs storno in SAP" | `post_sap_staging.py` |
| 3 | **Finished-day guard**: the auto-poster only claims MCH_HOURS bundles with `bucket_start < today`, so a day that is still growing is not locked | `post_sap_staging.py` |
| 4 | **Auto-poster skips corrections**: `is_correction=true` never auto-posts, only through `--ids` (admin button) | `post_sap_staging.py` |
| 5 | **Freeze trigger**: key fields of a record that **was already sent** cannot change; the attempt is logged in `sap_source_change_blocked`. The ETL keeps running | `mch_transaction` |
| 6 | **Invalidation trigger**: when a source record changes and its bundle is still PENDING, the stale bundle is **deleted** and catch-up stages it again | `mch_transaction` |
| + | **Burned ZTIMESHEETID guard**: checks `log_timesheet_sap`. Did SAP ever return SUCCESS for this ID? Then `SKIPPED` | `post_sap_staging.py` |

### The data repair loop

```
EWS accuracy_machine points at an incomplete record
   -> admin fixes it (mch_transaction_override) -> ETL re-derives mch_transaction
   -> invalidation trigger deletes the stale PENDING bundle
   -> catch-up stages it again (NORMAL if the day is open, CORRECTION if it is closed)
   -> poster sends it (automatically for normal, by hand for corrections)
```

---

## Dangerous limits

1. **Do not change the md5 recipe of `source_key`** without a plan. The whole history is re-keyed,
   looks new, and is sent to SAP again. (The segment guard will catch it, but do not test your luck.)
2. **Do not reset the `id` sequence** before every POSTED row has been reversed in SAP. ZTIMESHEETIDs that SAP
   already accepted would be reused, and legitimate rows would be rejected as duplicates.
3. **Do not rebuild or catch up dates outside the managed range.** Old data (June, for example) was sent to SAP
   **without provenance**. Staging it again puts the hours in twice.
4. **Do not bring back `status_record` as a gate** (see above).
5. **Do not force `--include-today`** on the current day unless you really mean to lock it. Records that
   arrive afterwards become CORRECTIONS and must be sent by hand.
6. **Do not write a percent sign (`%`) in SQL comments** that psycopg2 executes. It is read as a format
   placeholder and the whole query fails.

---

## Open issues

- **SAP rejects unproductive rows**: *"Enter activity type only in conjunction with cost center"*.
  The payload **has no KOSTL field**, and `cost_center` in `mch_transaction` is filled for only about 14% of rows.
  The fix belongs **on the SAP side** (probably deriving KOSTL from the work center, ARBPL).
  Until then, post with `--productive-only`.
- **No storno**: the guards only **detect** a conflict. Reversing a wrong posting in SAP is still manual.

---

## Reading SAP errors

| Message | Meaning | Action |
|---|---|---|
| `Order X is already being processed by SAPCI` | Temporary order lock: two requests for the same order at once | Retried automatically. If it happens often, lower `--workers` |
| `User status TECO is active` | The order is *technically complete* and cannot take confirmations | Business decision: reopen TECO in SAP, or let it go |
| `Enter activity type only in conjunction with cost center` | Unproductive row (LSTAR without KOSTL) | Wait for the SAP-side fix |
| `SSL: UNEXPECTED_EOF` / `read operation timed out` | **Network**, not an SAP rejection. The request may or may not have arrived | Retrying is **safe** (same ID, so SAP rejects the duplicate) |

---

## Quick audit

```sql
-- Which records did this bundle come from?
SELECT source_row_id, seconds FROM sap_staging_source WHERE staging_id = 163449;

-- Has this record ever gone to SAP?
SELECT t.id, t.status, t.posted_at FROM sap_staging_source s
JOIN sap_timesheet_staging t ON t.id = s.staging_id
WHERE s.source_row_id = '501523';

-- Queue state (normal vs correction)
SELECT status, is_correction, is_productive, count(*)
FROM sap_timesheet_staging GROUP BY 1,2,3 ORDER BY 1,2,3;

-- Corrections waiting for an admin
SELECT bucket_start::date, count(*), round(sum(total_seconds)/60.0,1) AS minutes
FROM sap_timesheet_staging WHERE is_correction AND status='PENDING'
GROUP BY 1 ORDER BY 1;

-- UI button queue
SELECT id, action, status, requested_at, started_at, finished_at
FROM sap_ops_request ORDER BY id DESC LIMIT 20;

-- Data changes REJECTED because the record was already sent to SAP
SELECT * FROM sap_source_change_blocked ORDER BY blocked_at DESC LIMIT 20;
```

---

## Environment

```text
DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD     # source (mch_transaction, timesheet)
PLANT_CODE TIMEZONE TGT_TABLE
SAP_INBOUND_URL SAP_INBOUND_USERNAME SAP_INBOUND_PASSWORD

SAP_STAGING_DB_HOST SAP_STAGING_DB_PORT ...     # optional: separate staging DB
SAP_STAGE_INITIAL_FROM_TS SAP_STAGE_CURSOR_OVERLAP_MINUTES SAP_STAGE_SAFETY_DELAY_MINUTES

# compose service intervals (optional)
SAP_STAGE_INTERVAL SAP_POST_INTERVAL SAP_POST_LIMIT SAP_POST_WORKERS SAP_OPS_INTERVAL
```
