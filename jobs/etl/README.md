# ETL jobs

Jobs that move order and machine data between the factory SQL Server, the SAP source database and each plant's PostgreSQL. Every script reads `.env` from the repository root when it exists.

## Python scripts

| File | What it does | Example |
|---|---|---|
| `etl_sync_v2.py` | Main order and confirmation sync from the source PostgreSQL to one or more plant databases. Uses `LISTEN/NOTIFY` plus polling, batches, retries with backoff and updates `status_etl`. | `python etl_sync_v2.py` |
| `sap_orders_producer.py` | Kafka mode. Reads `ph3_order` rows with status `NEW` from the SAP source database (`LISTEN etl_new_row` plus polling), publishes them to `sap.orders.v1` (key = confirmation_number, compacted) and marks them `UPDATED` once the broker acknowledges. Replaces the fan-out in `etl_sync_v2.py`. | `python sap_orders_producer.py` |
| `sap_orders_consumer.py` | Kafka mode. One instance per plant database (consumer group `iems-orders-<plant>`). Upserts `ph3_order` and `sow` in one transaction and commits the offset after the database commit. Bad messages go to `sap.orders.dlq.v1`. | `python sap_orders_consumer.py` |
| `order_sync_core.py` | Order and SOW upsert logic shared by `etl_sync_v2.py` and `sap_orders_consumer.py`, so both modes write identical rows. | (module) |
| `etl_order.py` | The first, simpler order sync from `SRC_TABLE` to `TGT_TABLE`, filtered by `PLANT_FILTER`. Strips leading zeros from some numbers, updates `status_etl` and fills `sow`. | `python etl_order.py` |
| `etl_machinehours.py` | Pulls validated machine hours from the SQL Server `PLANT_OEE` database and upserts them into `public.mch_transaction`. Supports a date range, truncate, batch size and dry run. | `python etl_machinehours.py --dry-run` |
| `etl_machine_conf.py` | Writes `ProductionData.JobID` in SQL Server from the PostgreSQL `confirmation_number`, then copies `ProductionData` into `public.mch_productiondata`. Can refresh the materialized view afterwards. | `python etl_machine_conf.py --from 2026-05-01 --dry-run` |
| `etl_mch_transaction_v3.py` | Derives `public.mch_transaction` from `mch_productiondata`: operator from `mch_user`, job from `ph3_order`, SOW fields from `sow`, and admin fixes from `mch_transaction_override`. This is the input to SAP staging. | `python etl_mch_transaction_v3.py --dry-run` |
| `sync_machine_heartbeat.py` | Copies machine heartbeat rows from SQL Server into PostgreSQL (it creates the target table on first run). The Early Warning dashboard reads them for HMI uptime. | `python sync_machine_heartbeat.py` |

## SQL

| File | What it does |
|---|---|
| `etl_trigger.sql` | Run once on the source database. Creates the function and trigger that `pg_notify` the `etl_new_row` channel when a `ph3_order` row with `status_etl = 'NEW'` is inserted or updated. |
| `sql_anomali_mch_productiondata.sql` | Per machine and day, counts segments whose `jobid` has a valid prefix against segments with an unexpected one. Used to find machines where operators enter job numbers wrongly. |

## Docker and dependencies

| File | What it does |
|---|---|
| `Dockerfile.etl` | Python 3.11 slim image for the ETL container. Runs `etl_sync_v2.py` by default. |
| `docker-compose.etl.yml` | The `timesheet_sap_etl` service: builds `Dockerfile.etl`, reads the root `.env`, mounts this folder at `/app`, restarts automatically. |
| `Dockerfile.heartbeat`, `docker-compose.heartbeat.yml` | Container for the heartbeat sync. |
| `requirements.txt` | `psycopg2-binary`, `python-dotenv`, `pyodbc`. |

## Quick commands

```bash
python etl_sync_v2.py
python etl_mch_transaction_v3.py --dry-run
python etl_machinehours.py --dry-run
python etl_machine_conf.py --dry-run
```
