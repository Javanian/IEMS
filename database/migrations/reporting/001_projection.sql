-- Apply only to a separately approved reporting database, never the source ledger.
BEGIN;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE TABLE reporting.heads (
 tenant_id uuid NOT NULL, plant_id uuid NOT NULL, aggregate_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0), resource_type text NOT NULL,
 legal_entity_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,plant_id,aggregate_id)
);
CREATE TABLE reporting.receipts (
 tenant_id uuid NOT NULL, plant_id uuid NOT NULL, event_id uuid NOT NULL,
 aggregate_id uuid NOT NULL, aggregate_version bigint NOT NULL,
 checksum text NOT NULL CHECK(length(checksum)=64),
 occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL, available_at timestamptz NOT NULL,
 envelope jsonb NOT NULL,
 CHECK(occurred_at<=received_at AND received_at<=available_at),
 PRIMARY KEY(tenant_id,plant_id,event_id),
 UNIQUE(tenant_id,plant_id,aggregate_id,aggregate_version),
 FOREIGN KEY(tenant_id,plant_id,aggregate_id) REFERENCES reporting.heads(tenant_id,plant_id,aggregate_id)
);
CREATE TABLE reporting.orders (
 tenant_id uuid NOT NULL, plant_id uuid NOT NULL, id uuid NOT NULL,
 amount numeric(38,12) NOT NULL CHECK(amount>=0), currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 deleted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,plant_id,id),
 FOREIGN KEY(tenant_id,plant_id,id) REFERENCES reporting.heads(tenant_id,plant_id,aggregate_id)
);
CREATE TABLE reporting.order_quantities (
 tenant_id uuid NOT NULL, plant_id uuid NOT NULL, order_id uuid NOT NULL,
 uom text NOT NULL CHECK(uom~'^[A-Z][A-Z0-9_]{0,31}$'),
 quantity numeric(38,12) NOT NULL CHECK(quantity>=0),
 PRIMARY KEY(tenant_id,plant_id,order_id,uom),
 FOREIGN KEY(tenant_id,plant_id,order_id) REFERENCES reporting.orders(tenant_id,plant_id,id)
);
CREATE TABLE reporting.source_coverage (
 tenant_id uuid NOT NULL, plant_id uuid NOT NULL, run_id uuid NOT NULL,
 observed_at timestamptz NOT NULL, manifest jsonb NOT NULL, checksum text NOT NULL,
 PRIMARY KEY(tenant_id,plant_id,run_id)
);
CREATE INDEX reporting_coverage_latest ON reporting.source_coverage(tenant_id,plant_id,observed_at DESC);
ALTER TABLE reporting.order_quantities ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.order_quantities FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.source_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.source_coverage FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped ON reporting.order_quantities USING(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid);
CREATE POLICY scoped ON reporting.source_coverage USING(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid);
CREATE TABLE reporting.payments (
 tenant_id uuid NOT NULL, plant_id uuid NOT NULL, id uuid NOT NULL, order_id uuid NOT NULL,
 amount numeric(38,12) NOT NULL CHECK(amount>=0), currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 deleted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,plant_id,id),
 FOREIGN KEY(tenant_id,plant_id,id) REFERENCES reporting.heads(tenant_id,plant_id,aggregate_id),
 FOREIGN KEY(tenant_id,plant_id,order_id) REFERENCES reporting.orders(tenant_id,plant_id,id)
);
CREATE TABLE reporting.fulfillments (
 tenant_id uuid NOT NULL, plant_id uuid NOT NULL, id uuid NOT NULL, order_id uuid NOT NULL,
 quantity numeric(38,12) NOT NULL CHECK(quantity>=0), uom text NOT NULL CHECK(length(uom) BETWEEN 1 AND 32),
 deleted boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,plant_id,id),
 FOREIGN KEY(tenant_id,plant_id,id) REFERENCES reporting.heads(tenant_id,plant_id,aggregate_id),
 FOREIGN KEY(tenant_id,plant_id,order_id) REFERENCES reporting.orders(tenant_id,plant_id,id)
);
CREATE INDEX reporting_payments_order ON reporting.payments(tenant_id,plant_id,order_id) WHERE NOT deleted;
CREATE INDEX reporting_fulfillments_order ON reporting.fulfillments(tenant_id,plant_id,order_id) WHERE NOT deleted;
CREATE INDEX reporting_receipts_available ON reporting.receipts(tenant_id,plant_id,available_at);
ALTER TABLE reporting.heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.heads FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE reporting.fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.fulfillments FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped ON reporting.heads USING(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid);
CREATE POLICY scoped ON reporting.receipts USING(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid);
CREATE POLICY scoped ON reporting.orders USING(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid);
CREATE POLICY scoped ON reporting.payments USING(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid);
CREATE POLICY scoped ON reporting.fulfillments USING(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid);
REVOKE ALL ON SCHEMA reporting FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM PUBLIC;
CREATE TABLE reporting.export_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL, plant_id uuid NOT NULL, user_id uuid NOT NULL,
 dataset text NOT NULL, run_id text NOT NULL, lineage_hash text NOT NULL,
 row_count integer NOT NULL CHECK(row_count BETWEEN 0 AND 10000),
 checksum text NOT NULL, occurred_at timestamptz NOT NULL
);
ALTER TABLE reporting.export_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE reporting.export_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped ON reporting.export_audit USING(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid) WITH CHECK(tenant_id=current_setting('iems.tenant_id',true)::uuid AND plant_id=current_setting('iems.plant_id',true)::uuid);
CREATE INDEX reporting_export_audit_scope ON reporting.export_audit(tenant_id,plant_id,occurred_at);
REVOKE ALL ON reporting.export_audit FROM PUBLIC;
COMMIT;
