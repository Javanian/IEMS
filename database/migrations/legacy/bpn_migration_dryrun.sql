
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.fn_delete_dup_sow()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM sow
    WHERE codenumber = NEW.codenumber
      AND order_no IS NOT NULL
      AND idsow < NEW.idsow;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_sync_modified()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    old_data jsonb;
    new_data jsonb;
BEGIN
    IF NEW.sync IS DISTINCT FROM OLD.sync THEN RETURN NEW; END IF;
    old_data := to_jsonb(OLD) - 'sync';
    new_data := to_jsonb(NEW) - 'sync';
    IF old_data IS DISTINCT FROM new_data THEN
        NEW.sync := 'modified';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.components (
    component_id bigint NOT NULL,
    part_name    text   NOT NULL,
    model        text   NOT NULL,
    part_number  text   NOT NULL
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relname='components_component_id_seq' AND n.nspname='public') THEN
        ALTER TABLE public.components ALTER COLUMN component_id
            ADD GENERATED ALWAYS AS IDENTITY (
                SEQUENCE NAME public.components_component_id_seq
                START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='components_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.components ADD CONSTRAINT components_pkey PRIMARY KEY (component_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='components_model_part_number_key' AND n.nspname='public') THEN
        ALTER TABLE public.components ADD CONSTRAINT components_model_part_number_key UNIQUE (model, part_number);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.log_timesheet_sap (
    id                        integer  NOT NULL,
    ztimesheetid              text,
    pernr                     text,
    confirmation_number       text,
    order_no                  text,
    operation_no              text,
    sequence_category         text,
    sequence_number           text,
    branch_operation_no       text,
    return_operation_no       text,
    zconf_type                text,
    work_center               text,
    activity_type             text,
    start_date                text,
    start_time                text,
    end_date                  text,
    end_time                  text,
    plant_code                text,
    final_completed_indicator text,
    zbarcodeid                text,
    sap_response              text,
    created_at                timestamp with time zone DEFAULT now()
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relname='log_timesheet_sap_id_seq' AND n.nspname='public') THEN
        ALTER TABLE public.log_timesheet_sap ALTER COLUMN id
            ADD GENERATED ALWAYS AS IDENTITY (
                SEQUENCE NAME public.log_timesheet_sap_id_seq
                START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='log_timesheet_sap_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.log_timesheet_sap ADD CONSTRAINT log_timesheet_sap_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ph3_order (
    id                    bigint                NOT NULL,
    confirmation_number   character varying(20) NOT NULL,
    indicator_code        character varying(20),
    operation_short_text  text,
    order_no              character varying(20) NOT NULL,
    operation_no          character varying(10),
    sequence_category     character varying(5),
    sequence_number       character varying(20),
    branch_operation_no   character varying(10),
    return_operation_no   character varying(10),
    material_no           character varying(50),
    material_description  text,
    operation_description text,
    work_center           character varying(30),
    cost_center           character varying(30),
    plant_code            character varying(10),
    unit_of_measure       character varying(10),
    standard_value        character varying(30),
    order_type            character varying(10),
    order_description     text,
    created_at            timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status_etl            character varying(10) DEFAULT 'NEW'::character varying
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relname='ph3_order_id_seq' AND n.nspname='public') THEN
        ALTER TABLE public.ph3_order ALTER COLUMN id
            ADD GENERATED ALWAYS AS IDENTITY (
                SEQUENCE NAME public.ph3_order_id_seq
                START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='ph3_order_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.ph3_order ADD CONSTRAINT ph3_order_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='ph3_order_confirmation_number_key' AND n.nspname='public') THEN
        ALTER TABLE public.ph3_order ADD CONSTRAINT ph3_order_confirmation_number_key UNIQUE (confirmation_number);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.production_operations (
    id                   bigint       NOT NULL,
    order_number         text,
    operation_number     integer,
    short_text           text,
    estimate_hour        numeric(10,2),
    confirmation         text,
    branch_operation     text,
    return_operation     text,
    sequence_category    text,
    sequence_number      text,
    material_code        text,
    material_description text,
    operation_status     text,
    order_type           text,
    plant                text,
    uom                  text,
    work_center          text,
    cost_center          text,
    order_system_status  text
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relname='production_operations_id_seq' AND n.nspname='public') THEN
        ALTER TABLE public.production_operations ALTER COLUMN id
            ADD GENERATED ALWAYS AS IDENTITY (
                SEQUENCE NAME public.production_operations_id_seq
                START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='production_operations_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.production_operations ADD CONSTRAINT production_operations_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.progress_update_history (
    id                integer                     NOT NULL,
    operation_id      integer                     NOT NULL,
    order_no          character varying(100),
    progress          integer                     NOT NULL,
    issue_description text,
    image_path        character varying(500),
    created_at        timestamp without time zone NOT NULL DEFAULT now(),
    created_by        character varying(100),
    CONSTRAINT progress_update_history_progress_check CHECK ((progress >= 1) AND (progress <= 100))
);
CREATE SEQUENCE IF NOT EXISTS public.progress_update_history_id_seq
    AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.progress_update_history_id_seq
    OWNED BY public.progress_update_history.id;
ALTER TABLE ONLY public.progress_update_history
    ALTER COLUMN id SET DEFAULT nextval('public.progress_update_history_id_seq'::regclass);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='progress_update_history_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.progress_update_history ADD CONSTRAINT progress_update_history_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.qh3_order (
    id                    bigint                NOT NULL,
    confirmation_number   character varying(20) NOT NULL,
    indicator_code        character varying(20),
    operation_short_text  text,
    order_no              character varying(20) NOT NULL,
    operation_no          character varying(10),
    sequence_category     character varying(5),
    sequence_number       character varying(20),
    branch_operation_no   character varying(10),
    return_operation_no   character varying(10),
    material_no           character varying(50),
    material_description  text,
    operation_description text,
    work_center           character varying(30),
    cost_center           character varying(30),
    plant_code            character varying(10),
    unit_of_measure       character varying(10),
    standard_value        character varying(30),
    order_type            character varying(10),
    order_description     text,
    created_at            timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status_etl            character varying(10) DEFAULT 'NEW'::character varying
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relname='qh3_order_id_seq' AND n.nspname='public') THEN
        ALTER TABLE public.qh3_order ALTER COLUMN id
            ADD GENERATED ALWAYS AS IDENTITY (
                SEQUENCE NAME public.qh3_order_id_seq
                START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='qh3_order_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.qh3_order ADD CONSTRAINT qh3_order_pkey PRIMARY KEY (id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='qh3_order_confirmation_number_key' AND n.nspname='public') THEN
        ALTER TABLE public.qh3_order ADD CONSTRAINT qh3_order_confirmation_number_key UNIQUE (confirmation_number);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sow_standard (
    id           bigint       NOT NULL,
    component_id bigint       NOT NULL,
    operation_no integer      NOT NULL,
    operation_text text       NOT NULL,
    machineid    text,
    workcenter   text,
    std_hours    numeric(10,2),
    source_plant integer
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relname='sow_standard_id_seq' AND n.nspname='public') THEN
        ALTER TABLE public.sow_standard ALTER COLUMN id
            ADD GENERATED ALWAYS AS IDENTITY (
                SEQUENCE NAME public.sow_standard_id_seq
                START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_standard_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_standard ADD CONSTRAINT sow_standard_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sow_standard_attachments (
    id            bigint                   NOT NULL,
    standard_id   bigint                   NOT NULL,
    filename      text                     NOT NULL,
    original_name text                     NOT NULL,
    file_path     text                     NOT NULL,
    file_size     integer,
    uploaded_at   timestamp with time zone DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS public.sow_standard_attachments_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.sow_standard_attachments_id_seq
    OWNED BY public.sow_standard_attachments.id;
ALTER TABLE ONLY public.sow_standard_attachments
    ALTER COLUMN id SET DEFAULT nextval('public.sow_standard_attachments_id_seq'::regclass);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_standard_attachments_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_standard_attachments ADD CONSTRAINT sow_standard_attachments_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sow_template_lines (
    id          bigint NOT NULL,
    template_id bigint NOT NULL,
    standard_id bigint NOT NULL
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relname='sow_template_lines_id_seq' AND n.nspname='public') THEN
        ALTER TABLE public.sow_template_lines ALTER COLUMN id
            ADD GENERATED ALWAYS AS IDENTITY (
                SEQUENCE NAME public.sow_template_lines_id_seq
                START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_template_lines_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_template_lines ADD CONSTRAINT sow_template_lines_pkey PRIMARY KEY (id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sow_templates (
    template_id  bigint                      NOT NULL,
    component_id bigint                      NOT NULL,
    template_name text                       NOT NULL,
    created_by   text,
    created_at   timestamp without time zone DEFAULT now()
);
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE c.relname='sow_templates_template_id_seq' AND n.nspname='public') THEN
        ALTER TABLE public.sow_templates ALTER COLUMN template_id
            ADD GENERATED ALWAYS AS IDENTITY (
                SEQUENCE NAME public.sow_templates_template_id_seq
                START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_templates_pkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_templates ADD CONSTRAINT sow_templates_pkey PRIMARY KEY (template_id);
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='operations' AND column_name='opr_no') THEN
        ALTER TABLE public.operations RENAME COLUMN opr_no TO operation_no;
    END IF;
END $$;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='operations' AND column_name='operationtext') THEN
        ALTER TABLE public.operations RENAME COLUMN operationtext TO operation_text;
    END IF;
END $$;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='operations'
                 AND column_name='wct_group' AND data_type='character varying') THEN
        ALTER TABLE public.operations
            ALTER COLUMN wct_group TYPE text,
            ALTER COLUMN workcenter TYPE text;
    END IF;
END $$;
ALTER TABLE public.operations ALTER COLUMN part_id DROP NOT NULL;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
               WHERE c.conname='operations_part_id_opr_no_key' AND n.nspname='public') THEN
        ALTER TABLE public.operations DROP CONSTRAINT operations_part_id_opr_no_key;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='operations_part_id_operation_no_key' AND n.nspname='public') THEN
        ALTER TABLE public.operations ADD CONSTRAINT operations_part_id_operation_no_key UNIQUE (part_id, operation_no);
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='parts'
                 AND column_name='partnumber' AND data_type='character varying') THEN
        ALTER TABLE public.parts
            ALTER COLUMN partnumber TYPE text,
            ALTER COLUMN partname   TYPE text,
            ALTER COLUMN model      TYPE text;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='parts'
                 AND column_name='created_at' AND data_type='timestamp with time zone') THEN
        ALTER TABLE public.parts
            ALTER COLUMN created_at TYPE timestamp without time zone USING (created_at AT TIME ZONE 'UTC'),
            ALTER COLUMN updated_at TYPE timestamp without time zone USING (updated_at AT TIME ZONE 'UTC');
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='sow' AND column_name='operationtext') THEN
        ALTER TABLE public.sow RENAME COLUMN operationtext TO operation_text;
    END IF;
END $$;
ALTER TABLE public.sow ADD COLUMN IF NOT EXISTS progress integer;
ALTER TABLE public.sow ALTER COLUMN sync SET DEFAULT 'new'::text;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='sow'
                 AND column_name='actual_hours' AND data_type='real') THEN
        ALTER TABLE public.sow
            ALTER COLUMN actual_hours TYPE numeric(10,2) USING actual_hours::numeric(10,2);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='chk_sow_actual_progress' AND n.nspname='public') THEN
        ALTER TABLE public.sow ADD CONSTRAINT chk_sow_actual_progress
            CHECK ((actual_progress IS NULL) OR (actual_progress >= 0 AND actual_progress <= 100));
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='chk_sow_progress' AND n.nspname='public') THEN
        ALTER TABLE public.sow ADD CONSTRAINT chk_sow_progress
            CHECK ((progress IS NULL) OR (progress >= 0 AND progress <= 100));
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
               WHERE c.conname='sow_codenumber_unique' AND n.nspname='public') THEN
        ALTER TABLE public.sow DROP CONSTRAINT sow_codenumber_unique;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_codenumber_uniq' AND n.nspname='public') THEN
        ALTER TABLE public.sow ADD CONSTRAINT sow_codenumber_uniq UNIQUE (codenumber);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='uq_sow_order_operation' AND n.nspname='public') THEN
        ALTER TABLE public.sow ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='timesheet_transaction' AND column_name='ssbr_ident') THEN
        ALTER TABLE public.timesheet_transaction RENAME COLUMN ssbr_ident TO ssbr_id;
    END IF;
END $$;
ALTER TABLE public.timesheet_transaction
    ADD COLUMN IF NOT EXISTS operation_no integer,
    ADD COLUMN IF NOT EXISTS order_no     text;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='timesheet_transaction'
                 AND column_name='planhours' AND data_type='text') THEN
        ALTER TABLE public.timesheet_transaction
            ALTER COLUMN planhours TYPE numeric(10,2)
                USING NULLIF(trim(planhours), '')::numeric(10,2);
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='timesheet_transaction'
                 AND column_name='std_foreman_hours' AND data_type='text') THEN
        ALTER TABLE public.timesheet_transaction
            ALTER COLUMN std_foreman_hours TYPE numeric(10,2)
                USING NULLIF(trim(std_foreman_hours), '')::numeric(10,2);
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='timesheet_transaction'
                 AND column_name='state_flag' AND data_type='text') THEN
        ALTER TABLE public.timesheet_transaction
            ALTER COLUMN state_flag TYPE smallint USING NULLIF(trim(state_flag), '')::smallint,
            ALTER COLUMN state_flag SET DEFAULT 1;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='timesheet_transaction'
                 AND column_name='duration' AND numeric_precision=10 AND numeric_scale=2) THEN
        ALTER TABLE public.timesheet_transaction ALTER COLUMN duration TYPE numeric;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='processcontroldata'
                 AND column_name='operation_no' AND data_type='text') THEN
        ALTER TABLE public.processcontroldata
            ALTER COLUMN operation_no TYPE integer
                USING NULLIF(trim(operation_no), '')::integer;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='usernfc_snssb_unique' AND n.nspname='public') THEN
        ALTER TABLE public.usernfc ADD CONSTRAINT usernfc_snssb_unique UNIQUE (snssb);
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_usernfc_nfcid ON public.usernfc USING btree (nfcid);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='workcenter_machineid_unique' AND n.nspname='public') THEN
        ALTER TABLE public.workcenter ADD CONSTRAINT workcenter_machineid_unique UNIQUE (machineid);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='workcenter_workcenternew_unique' AND n.nspname='public') THEN
        ALTER TABLE public.workcenter ADD CONSTRAINT workcenter_workcenternew_unique UNIQUE (workcenternew);
    END IF;
END $$;

DROP TRIGGER IF EXISTS update_sow_updated_at ON public.sow;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.triggers
                   WHERE event_object_schema='public' AND event_object_table='sow'
                     AND trigger_name='before_update_set_sync') THEN
        CREATE TRIGGER before_update_set_sync
            BEFORE UPDATE ON public.sow
            FOR EACH ROW EXECUTE FUNCTION public.trg_set_sync_modified();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.triggers
                   WHERE event_object_schema='public' AND event_object_table='sow'
                     AND trigger_name='trg_delete_dup_sow') THEN
        CREATE TRIGGER trg_delete_dup_sow
            AFTER INSERT ON public.sow
            FOR EACH ROW EXECUTE FUNCTION public.fn_delete_dup_sow();
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
               WHERE c.conname='fk_processcontroldata_timesheet' AND n.nspname='public') THEN
        ALTER TABLE public.processcontroldata DROP CONSTRAINT fk_processcontroldata_timesheet;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='fk_pcd_timesheet' AND n.nspname='public') THEN
        ALTER TABLE public.processcontroldata ADD CONSTRAINT fk_pcd_timesheet
            FOREIGN KEY (tsnumber) REFERENCES public.timesheet_transaction(tsnumber) ON DELETE SET NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
               WHERE c.conname='fk_process_parameter_process' AND n.nspname='public') THEN
        ALTER TABLE public.process_parameter DROP CONSTRAINT fk_process_parameter_process;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='fk_pp_process_category' AND n.nspname='public') THEN
        ALTER TABLE public.process_parameter ADD CONSTRAINT fk_pp_process_category
            FOREIGN KEY (id_process) REFERENCES public.process_category(id_process) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_standard_component_id_fkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_standard ADD CONSTRAINT sow_standard_component_id_fkey
            FOREIGN KEY (component_id) REFERENCES public.components(component_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_standard_attachments_standard_id_fkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_standard_attachments ADD CONSTRAINT sow_standard_attachments_standard_id_fkey
            FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_template_lines_standard_id_fkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_template_lines ADD CONSTRAINT sow_template_lines_standard_id_fkey
            FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_template_lines_template_id_fkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_template_lines ADD CONSTRAINT sow_template_lines_template_id_fkey
            FOREIGN KEY (template_id) REFERENCES public.sow_templates(template_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='sow_templates_component_id_fkey' AND n.nspname='public') THEN
        ALTER TABLE public.sow_templates ADD CONSTRAINT sow_templates_component_id_fkey
            FOREIGN KEY (component_id) REFERENCES public.components(component_id);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='fk_puh_sow_operation' AND n.nspname='public') THEN
        ALTER TABLE public.progress_update_history ADD CONSTRAINT fk_puh_sow_operation
            FOREIGN KEY (operation_id) REFERENCES public.sow(idsow) ON DELETE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
                   WHERE c.conname='fk_timesheet_user' AND n.nspname='public') THEN
        ALTER TABLE public.timesheet_transaction ADD CONSTRAINT fk_timesheet_user
            FOREIGN KEY (serialnumber) REFERENCES public.usernfc(snssb)
            ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pcd_operation_no         ON public.processcontroldata      USING btree (operation_no);
CREATE INDEX IF NOT EXISTS idx_pcd_production_order     ON public.processcontroldata      USING btree (production_order);
CREATE INDEX IF NOT EXISTS idx_pcd_snssb                ON public.processcontroldata      USING btree (snssb);
CREATE INDEX IF NOT EXISTS idx_pcd_tsnumber             ON public.processcontroldata      USING btree (tsnumber);
CREATE INDEX IF NOT EXISTS idx_pcdi_id_parameter        ON public.processcontroldata_item USING btree (id_parameter);
CREATE INDEX IF NOT EXISTS idx_pcdi_id_processcontroldata ON public.processcontroldata_item USING btree (id_processcontroldata);
CREATE INDEX IF NOT EXISTS idx_pp_id_process            ON public.process_parameter       USING btree (id_process);
CREATE INDEX IF NOT EXISTS idx_ppcb_id_parameter        ON public.process_parameter_choicebase USING btree (id_parameter);
CREATE INDEX IF NOT EXISTS idx_prodops_order_operation  ON public.production_operations   USING btree (order_number, operation_number);
CREATE INDEX IF NOT EXISTS idx_puh_created_at           ON public.progress_update_history USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_puh_operation_id         ON public.progress_update_history USING btree (operation_id);
CREATE INDEX IF NOT EXISTS idx_sow_codenumber           ON public.sow                    USING btree (codenumber);
CREATE INDEX IF NOT EXISTS idx_sow_order_no             ON public.sow                    USING btree (order_no);
CREATE INDEX IF NOT EXISTS idx_sow_ssbr_id              ON public.sow                    USING btree (ssbr_id);
CREATE INDEX IF NOT EXISTS idx_sow_workcenter           ON public.sow                    USING btree (workcenter);
CREATE INDEX IF NOT EXISTS idx_sow_sync_modified        ON public.sow                    USING btree (order_no, operation_no) WHERE (sync = 'modified'::text);
CREATE INDEX IF NOT EXISTS idx_sow_part_name_trgm       ON public.sow                    USING gin   (part_name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sow_std_attach_standard_id ON public.sow_standard_attachments USING btree (standard_id);
CREATE INDEX IF NOT EXISTS idx_sow_standard_component_id ON public.sow_standard          USING btree (component_id);
CREATE INDEX IF NOT EXISTS idx_sow_standard_source_plant ON public.sow_standard          USING btree (source_plant);
CREATE INDEX IF NOT EXISTS idx_sow_tmpl_lines_standard_id ON public.sow_template_lines   USING btree (standard_id);
CREATE INDEX IF NOT EXISTS idx_sow_tmpl_lines_template_id ON public.sow_template_lines   USING btree (template_id);
CREATE INDEX IF NOT EXISTS idx_ts_longdate_checkout     ON public.timesheet_transaction   USING btree (longdate_checkout);
CREATE INDEX IF NOT EXISTS idx_ts_operation_no          ON public.timesheet_transaction   USING btree (operation_no);
CREATE INDEX IF NOT EXISTS idx_ts_order_no              ON public.timesheet_transaction   USING btree (order_no);
CREATE INDEX IF NOT EXISTS idx_ts_order_wc              ON public.timesheet_transaction   USING btree (order_no, workcentercode);
CREATE INDEX IF NOT EXISTS idx_ts_state_flag            ON public.timesheet_transaction   USING btree (state_flag);
CREATE INDEX IF NOT EXISTS idx_ts_workcentercode        ON public.timesheet_transaction   USING btree (workcentercode);
CREATE INDEX IF NOT EXISTS idx_ts_full_name_trgm        ON public.timesheet_transaction   USING gin   (full_name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ts_order_no_trgm         ON public.timesheet_transaction   USING gin   (order_no public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ts_serialnumber_trgm     ON public.timesheet_transaction   USING gin   (serialnumber public.gin_trgm_ops);

CREATE OR REPLACE VIEW public.vw_sow_orders AS
 SELECT s.order_no,
    (array_agg(s.idsow        ORDER BY s.operation_no))[1] AS idsow,
    (array_agg(s.ssbr_id      ORDER BY s.operation_no))[1] AS ssbr_id,
    (array_agg(s.part_number  ORDER BY s.operation_no))[1] AS part_number,
    (array_agg(s.part_name    ORDER BY s.operation_no))[1] AS part_name,
    (array_agg(s.model        ORDER BY s.operation_no))[1] AS model,
    (array_agg(s.customer     ORDER BY s.operation_no))[1] AS customer,
    (array_agg(s.location     ORDER BY s.operation_no))[1] AS location,
    (array_agg(s.type         ORDER BY s.operation_no))[1] AS type,
    (array_agg(s."group"      ORDER BY s.operation_no))[1] AS "group",
    (array_agg(s.category     ORDER BY s.operation_no))[1] AS category,
    (array_agg(s.status       ORDER BY s.operation_no))[1] AS status,
    (array_agg(s.systemstatus ORDER BY s.operation_no))[1] AS systemstatus,
    (array_agg(s.confirmation ORDER BY s.operation_no))[1] AS confirmation,
    (array_agg(s.created_by   ORDER BY s.operation_no))[1] AS created_by,
    count(*) AS operation_count,
    COALESCE(sum(s.planhours), (0)::numeric) AS total_planhours,
    round(avg(
        CASE
            WHEN s.planhours IS NOT NULL AND s.planhours::numeric <> 0
              AND (s.workcenter IS NULL OR s.workcenter !~~* '%OT%')
            THEN s.progress
            ELSE NULL::integer
        END
    ), 1) AS avg_progress
   FROM public.sow s
  GROUP BY s.order_no;

CREATE MATERIALIZED VIEW IF NOT EXISTS public."order" AS
 SELECT sow.order_no,
    min(sow.ssbr_id)      AS ssbr_id,
    min(sow.part_number)  AS part_number,
    min(sow.part_name)    AS part_name,
    min(sow.model)        AS model,
    min(sow.customer)     AS customer,
    min(sow.location)     AS location,
    min(sow.status)       AS status,
    min(sow."group")      AS "group",
    min(sow.systemstatus) AS systemstatus,
    sum(sow.planhours)    AS planhours
   FROM public.sow
  GROUP BY sow.order_no
  WITH NO DATA;

ROLLBACK;

