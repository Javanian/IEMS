# MPS — Manufacturing Production System

A production planning & execution (PPC) platform for a heavy-equipment
manufacturing company, used daily across 4 plant sites. It unifies labor
time tracking, machine hours, SOW/bay scheduling, early-warning monitoring,
and automated posting into SAP S/4HANA.

Designed and built solo — architecture, frontend, backend, database,
infrastructure, and SAP integration — as the company's sole internal
developer.

> This is a curated public snapshot of the production codebase. Real
> credentials, plant-specific data exports, internal planning notes, and
> other non-runtime tooling are excluded.

**Tee San** — Full-Stack Developer & Data Engineer
[Portfolio](https://t-project-portfolio.vercel.app) · [GitHub](https://github.com/Javanian) · [teesanfajar@gmail.com](mailto:teesanfajar@gmail.com)

## Highlights

- **600** users (~500 operators, ~100 admins) across **4 plants**, daily use
- **394K** automated ETL runs over 5 months at **99.9%** success rate
- Timesheet validation turnaround: **~3 days → same day**
- SAP S/4HANA integration via SAP CPI, with anti-double-post protection
  (unique source keys) — replaced a 3-person manual posting process
- **97** database migrations (83 application + 14 legacy) via a custom
  migration runner
- Offline-first: full stack runs on each plant's local network, no
  dependency on internet access

## Features

- **Labor timesheet** — NFC-card login, per-job check-in/check-out,
  hierarchical validation, Excel export.
- **Machine hours** — ETL from factory SQL Server/HMI sources: segment
  splitting, normalization, bundling per shift, validation.
- **SOW & bay scheduling** — order pool, bay reservations on an area map
  and timeline, NFC confirmation, sub-operation progress tracking.
- **Early Warning System (EWS)** — periodic OEE/OLE/adoption snapshots,
  threshold-based issue detection, real-time SSE notifications and local
  TTS voice alerts.
- **SAP posting pipeline** — staging of timesheet records and machine-hour
  bundles with anti-double-post protection (unique source keys), automatic
  posting, retry, correction, and an operations queue UI.
- **Component tracking** — buffer transactions, receiving/shipment,
  consumables & tools management, kanban, process control.
- **Operations hub & dashboards** — active orders, TECO, machine
  productive time, validation pending, OEE/OLE dashboards.

## Architecture

Monorepo with a full-stack, service-oriented layout:

```
apps/
  web/                React 19 + Vite 7 + Tailwind 3 (PWA, offline-first)
  api/                Node.js / Express REST API (CommonJS)
  fastapi-msproject/  FastAPI service: MS Project synchronization
  tts-worker/         Python TTS worker (Piper, local voice alerts)
jobs/
  etl/                Machine-hours ETL from SQL Server
  sap_staging/        SAP staging pipeline (stage → post → ops queue)
  sow/                SOW seed & export
  machine_ping/       Machine heartbeat worker
database/
  migrate.js          Migration runner
  migrations/         SQL migrations (97 total — application + legacy)
infra/
  nginx/              Reverse proxy configuration
docker-compose.yml    16-service production stack
```

**Production stack (Docker Compose):** PostgreSQL 15 + PgBouncer (connection
pooling), Express API, React frontend served by Nginx with TLS, FastAPI
service, ETL workers, SAP staging/posting workers, EWS snapshot jobs, and
local TTS workers — deployed independently per plant.

## Tech Stack

| Layer       | Technologies |
|-------------|--------------|
| Frontend    | React 19, Vite 7, Tailwind CSS 3, React Router, ECharts/Recharts, @dnd-kit, PWA (vite-plugin-pwa) |
| Backend     | Node.js ≥ 18, Express 4, FastAPI |
| Database    | PostgreSQL 15, PgBouncer, SQL Server (ETL source) |
| Python      | ETL scripts, SAP staging pipeline, Piper TTS |
| Infra       | Docker & Docker Compose, Nginx + TLS, Linux |
| Integration | REST APIs, SAP S/4HANA (SAP CPI), MS Project |

## Getting Started (development)

```bash
# 1. Install dependencies
cd apps/web && npm install
cd ../../apps/api && npm install

# 2. Prepare environment
cp .env.example .env   # adjust values

# 3. Start database (PostgreSQL + PgBouncer)
docker compose up -d db pgbouncer

# 4. Run migrations
node database/migrate.js

# 5. Start API and web in dev mode
cd apps/api && npm run dev      # port 3001
cd apps/web && npm run dev      # port 5173 (Vite dev server)
```

## Production Deployment

Each site runs its own stack:

```bash
docker compose up -d --build
```

All frontend assets are bundled locally; the application is fully usable on
a factory LAN with no internet access. ETL and SAP workers are configured
via environment variables (see `.env.example`).

## License

All rights reserved. This repository is published for demonstration
purposes; production data and internal configuration are not included.
