# Portfolio API

The commercial and operations side of IEMS: customers, quotes, sales orders, purchasing, warehouse stock, manufacturing work orders, shipments, invoices, repair cases, PDF documents and a customer-service inbox. It runs on Node.js 24, Express 5 and MongoDB, separate from the plant stack in `apps/api`, and every record belongs to one tenant and one plant.

The full route-by-route contract is in [CONTRACT.md](CONTRACT.md).

## Modules

| Module | Routes | What it covers |
|---|---|---|
| Session | `/api/session/*` | Cookie login, logout, current user and capabilities |
| CRM | `/api/crm/accounts`, `/api/crm/opportunities` | Accounts, contacts, opportunities with a staged pipeline |
| Commercial | `/api/commercial/quotes`, `/api/commercial/orders` | Quote revisions, approval, conversion to a sales order |
| Procurement | `/api/procurement/*` | Vendors and purchase requests |
| Warehouse | `/api/warehouse/*` | Receipts, bins, transfers, counts and stock holds |
| Manufacturing | `/api/manufacturing/*` | Engineering BOM and routing revisions, work orders, operator labor |
| Fulfillment | `/api/fulfillment/*` | Shipments, invoices, payments, per-order balances and reconciliation |
| Repair | `/api/repair/*` | Repair cases and their invoices |
| Documents | `/api/documents/*` | Issue a quote or invoice PDF once, then read it back |
| Customer service | `/api/cs/*` | Conversations, tickets, operator takeover, a message simulator |

## Rules every module follows

- **Money is a string.** Amounts are fixed-scale decimal strings (`"128000.00"`) with a scale per currency (IDR 2, JPY 0, KWD 3). No route converts money to a JavaScript `Number`.
- **Tenant and plant come from the session.** Every database query filters on both. A tenant or plant sent in a header, query or body has to match the session or the request gets a 403; a record from another tenant is a 404.
- **Writes use optimistic concurrency.** A change sends `expectedVersion`; a stale version returns 409 and writes nothing.
- **One transaction per change.** The domain write, its history, the audit row and the outbox event commit together in a MongoDB transaction, or none of them do. The tests inject failing validators on the audit and outbox collections to prove the rollback.
- **Retries are safe.** Commands that create money or stock movements take an idempotency key. Replaying the same key returns the first response and changes nothing.
- **Issued documents do not change.** A PDF is rendered from a frozen snapshot, stored with its hash and never re-rendered with new prices.

## Run the tests

```bash
cd apps/portfolio-api
npm ci
npm test        # every maintained test file, against a real MongoDB 7.0.14 replica set
npm run check   # syntax check of src, tests and scripts
```

The tests start a throwaway single-node replica set through `mongodb-memory-server`, use a random database name, talk to the API over real HTTP on loopback, and delete everything afterwards. Set `MONGOMS_SYSTEM_BINARY` to use a MongoDB binary you already have.

## Run the server

The server needs a writable MongoDB replica set on loopback and refuses anything else:

```bash
export PORTFOLIO_MONGO_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0'
export PORTFOLIO_DB='portfolio_owned_local'      # must start with portfolio_owned_
export PORTFOLIO_ORIGINS='http://localhost:4173'
export PORTFOLIO_PORT=4313
read -r -s -p 'Seed password (12+ characters): ' PORTFOLIO_SEED_PASSWORD; export PORTFOLIO_SEED_PASSWORD
npm run seed -- --synthetic-owned                # two demo users: alpha.owner, beta.owner
unset PORTFOLIO_SEED_PASSWORD
npm start
```

The seed only runs when you call it, only on a `portfolio_owned_` database, and stores passwords as salted scrypt hashes. The server binds to 127.0.0.1. Behind TLS, set `PORTFOLIO_SECURE_COOKIE=true`.

## Not included

There is no login rate limiting, account lockout or password reset. The VAT policy (`FIXTURE_VAT_11_V1`, a fixed 11%) is a fixture for demonstrating the invoice math, not a tax engine. The customer-service inbox prepares replies but never sends a real WhatsApp message.
