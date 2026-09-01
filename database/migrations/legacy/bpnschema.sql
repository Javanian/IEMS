
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';

CREATE FUNCTION public.fn_delete_dup_sow() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM sow
    WHERE codenumber = NEW.codenumber
      AND order_no IS NOT NULL
      AND idsow < NEW.idsow;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_modified_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.modified_at = NOW();
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.trg_set_sync_modified() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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

CREATE FUNCTION public.update_modified_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$;

CREATE FUNCTION public.update_nnva_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.buffer_transaction (
    id bigint NOT NULL,
    machine_id text NOT NULL,
    type text NOT NULL,
    component_id bigint,
    component_label text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    reference_no text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    order_no text,
    ssbr_id text,
    operation_no integer,
    operation_text text,
    priority integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT buffer_transaction_type_check CHECK ((type = ANY (ARRAY['in'::text, 'out'::text, 'moving'::text])))
);

CREATE SEQUENCE public.buffer_transaction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.buffer_transaction_id_seq OWNED BY public.buffer_transaction.id;

CREATE TABLE public.component_hours (
    id bigint NOT NULL,
    machine_id text NOT NULL,
    component_id bigint,
    component_label text,
    total_hours numeric(12,2) DEFAULT 0 NOT NULL,
    last_calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    note text
);

CREATE SEQUENCE public.component_hours_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.component_hours_id_seq OWNED BY public.component_hours.id;

CREATE TABLE public.components (
    component_id bigint NOT NULL,
    part_name text NOT NULL,
    model text NOT NULL,
    part_number text NOT NULL
);

ALTER TABLE public.components ALTER COLUMN component_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.components_component_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.consumable_item (
    id integer NOT NULL,
    materialcode text NOT NULL,
    materialdescription text NOT NULL,
    quanitty numeric NOT NULL,
    uom text,
    created timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cost_center text,
    cis_no text NOT NULL,
    gl_account text NOT NULL,
    code_mm text,
    status text DEFAULT 'active'::text NOT NULL,
    rejected_by text,
    rejected_reason text,
    rejected_at timestamp without time zone,
    adjusted_by text,
    adjusted_at timestamp without time zone,
    CONSTRAINT consumable_item_quanitty_check CHECK ((quanitty > (0)::numeric))
);

ALTER TABLE public.consumable_item ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.consumable_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.consumable_stock (
    material_code text,
    code_mm text,
    material_description text,
    mrp_type text,
    plant text,
    quantity numeric DEFAULT 0 NOT NULL,
    type text,
    uom text,
    id integer NOT NULL
);

ALTER TABLE public.consumable_stock ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.consumable_stock_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.consumable_ticket (
    cis_no text NOT NULL,
    sn_karyawan text NOT NULL,
    nama_karyawan text NOT NULL,
    workcenter text,
    machineid text,
    comment text,
    status text DEFAULT 'waiting leader'::text NOT NULL,
    person_image text,
    closedate timestamp without time zone,
    created timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    id integer NOT NULL,
    image_person text,
    picked_by_sn text,
    picked_by_name text,
    picked_by_workcenter text,
    picked_by_machineid text,
    picked_by_nfcid text,
    picked_by_role text,
    picked_at timestamp without time zone
);

ALTER TABLE public.consumable_ticket ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.consumable_ticket_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.customers (
    id integer NOT NULL,
    name character varying(200),
    site_name character varying(200),
    site_location character varying(300),
    contact_person character varying(100),
    phone character varying(20),
    email character varying(100),
    address text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

ALTER TABLE public.customers ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.log_timesheet_sap (
    id integer NOT NULL,
    ztimesheetid text,
    pernr text,
    confirmation_number text,
    order_no text,
    operation_no text,
    sequence_category text,
    sequence_number text,
    branch_operation_no text,
    return_operation_no text,
    zconf_type text,
    work_center text,
    activity_type text,
    start_date text,
    start_time text,
    end_date text,
    end_time text,
    plant_code text,
    final_completed_indicator text,
    zbarcodeid text,
    sap_response text,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.log_timesheet_sap ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.log_timesheet_sap_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.mch_machines (
    machineno integer NOT NULL,
    sitemachineno integer,
    machinegroupid integer,
    plantid integer,
    machinetypeid integer,
    machineid character varying(50),
    machinename character varying(255),
    ipaddress character varying(50),
    description text,
    brand character varying(100),
    modelnumber character varying(100),
    serialnumber character varying(100),
    buildyear integer,
    mqtt_topic character varying(255),
    mqtt_topic_param character varying(255)
);

CREATE TABLE public.mch_productiondata (
    proddataid integer NOT NULL,
    startdatetime timestamp without time zone NOT NULL,
    enddatetime timestamp without time zone,
    machineno integer NOT NULL,
    statusid smallint NOT NULL,
    previoustatusid smallint,
    duration integer,
    "Notes" character varying(100),
    operatorid character varying(100),
    jobid character varying(100),
    "JobComplete" boolean
);

CREATE TABLE public.mch_statustypes (
    statusid integer NOT NULL,
    mainstatusid integer,
    description character varying(100),
    activitytype character varying(10)
);

CREATE TABLE public.operations (
    operation_id integer NOT NULL,
    part_id integer,
    operation_no integer NOT NULL,
    operation_text text NOT NULL,
    wct_group text,
    workcenter text,
    planhours numeric(5,2),
    drawing_path text,
    remark text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.operations ALTER COLUMN operation_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.operations_operation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sow (
    idsow integer NOT NULL,
    order_no text,
    operation_no integer NOT NULL,
    ssbr_id text,
    part_number text,
    part_name text,
    model text,
    customer text,
    location text,
    wct_group text,
    workcenter text,
    operation_text text,
    workcenterdescription text,
    planhours numeric(10,2),
    systemstatus text,
    confirmation text,
    status text,
    finish_date date,
    codenumber text GENERATED ALWAYS AS ((order_no || (operation_no)::text)) STORED,
    weight numeric(5,2),
    created_by text,
    type text,
    "group" text,
    category text,
    remark text,
    sync text DEFAULT 'new'::text,
    plan_start date,
    plan_finish date,
    actual_start date,
    actual_finish date,
    actual_progress numeric(5,2),
    actual_hours numeric(10,2),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    progress integer,
    CONSTRAINT chk_sow_actual_progress CHECK (((actual_progress IS NULL) OR ((actual_progress >= (0)::numeric) AND (actual_progress <= (100)::numeric)))),
    CONSTRAINT chk_sow_progress CHECK (((progress IS NULL) OR ((progress >= 0) AND (progress <= 100))))
);

CREATE MATERIALIZED VIEW public."order" AS
 SELECT sow.order_no,
    min(sow.ssbr_id) AS ssbr_id,
    min(sow.part_number) AS part_number,
    min(sow.part_name) AS part_name,
    min(sow.model) AS model,
    min(sow.customer) AS customer,
    min(sow.location) AS location,
    min(sow.status) AS status,
    min(sow."group") AS "group",
    min(sow.systemstatus) AS systemstatus,
    sum(sow.planhours) AS planhours
   FROM public.sow
  GROUP BY sow.order_no
  WITH NO DATA;

CREATE TABLE public.packing_types (
    id integer NOT NULL,
    name character varying(100)
);

ALTER TABLE public.packing_types ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.packing_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.part_categories (
    id integer NOT NULL,
    name character varying(100)
);

ALTER TABLE public.part_categories ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.part_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.parts (
    part_id integer NOT NULL,
    partnumber text NOT NULL,
    partname text NOT NULL,
    model text NOT NULL,
    drawing_path text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.parts ALTER COLUMN part_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.parts_part_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.ph3_order (
    id bigint NOT NULL,
    confirmation_number character varying(20) NOT NULL,
    indicator_code character varying(20),
    operation_short_text text,
    order_no character varying(20) NOT NULL,
    operation_no character varying(10),
    sequence_category character varying(5),
    sequence_number character varying(20),
    branch_operation_no character varying(10),
    return_operation_no character varying(10),
    material_no character varying(50),
    material_description text,
    operation_description text,
    work_center character varying(30),
    cost_center character varying(30),
    plant_code character varying(10),
    unit_of_measure character varying(10),
    standard_value character varying(30),
    order_type character varying(10),
    order_description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status_etl character varying(10) DEFAULT 'NEW'::character varying
);

ALTER TABLE public.ph3_order ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ph3_order_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.process_category (
    id_process integer NOT NULL,
    process_name text NOT NULL,
    description text
);

ALTER TABLE public.process_category ALTER COLUMN id_process ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.process_category_id_process_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.process_parameter (
    id_parameter integer NOT NULL,
    parameter_name text NOT NULL,
    description text,
    parameter_no integer,
    uom text,
    ischoice boolean DEFAULT false,
    isnumber boolean DEFAULT false,
    id_process integer NOT NULL
);

CREATE TABLE public.process_parameter_choicebase (
    id_choice integer NOT NULL,
    choice_name text NOT NULL,
    description text,
    id_parameter integer NOT NULL
);

ALTER TABLE public.process_parameter_choicebase ALTER COLUMN id_choice ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.process_parameter_choicebase_id_choice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE public.process_parameter ALTER COLUMN id_parameter ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.process_parameter_id_parameter_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.processcontroldata (
    id_processcontroldata integer NOT NULL,
    snssb text,
    full_name text,
    production_order text,
    ssbr_id text,
    operation_text text,
    operation_no integer,
    machineid text,
    workcenter text,
    validation_status text,
    validation_date timestamp with time zone,
    validation_by text,
    createddate timestamp with time zone DEFAULT now(),
    tsnumber integer
);

ALTER TABLE public.processcontroldata ALTER COLUMN id_processcontroldata ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.processcontroldata_id_processcontroldata_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.processcontroldata_item (
    id_processcontroldata_item integer NOT NULL,
    category_name text,
    parameter_name text,
    value text,
    uom text,
    ischoice boolean,
    isnumber boolean,
    status text,
    note text,
    id_parameter integer,
    id_processcontroldata integer NOT NULL,
    createddate timestamp with time zone DEFAULT now()
);

ALTER TABLE public.processcontroldata_item ALTER COLUMN id_processcontroldata_item ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.processcontroldata_item_id_processcontroldata_item_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.production_operations (
    id bigint NOT NULL,
    order_number text,
    operation_number integer,
    short_text text,
    estimate_hour numeric(10,2),
    confirmation text,
    branch_operation text,
    return_operation text,
    sequence_category text,
    sequence_number text,
    material_code text,
    material_description text,
    operation_status text,
    order_type text,
    plant text,
    uom text,
    work_center text,
    cost_center text,
    order_system_status text
);

ALTER TABLE public.production_operations ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.production_operations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.progress_update_history (
    id integer NOT NULL,
    operation_id integer NOT NULL,
    order_no character varying(100),
    progress integer NOT NULL,
    issue_description text,
    image_path character varying(500),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by character varying(100),
    CONSTRAINT progress_update_history_progress_check CHECK (((progress >= 1) AND (progress <= 100)))
);

CREATE SEQUENCE public.progress_update_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.progress_update_history_id_seq OWNED BY public.progress_update_history.id;

CREATE TABLE public.qh3_order (
    id bigint NOT NULL,
    confirmation_number character varying(20) NOT NULL,
    indicator_code character varying(20),
    operation_short_text text,
    order_no character varying(20) NOT NULL,
    operation_no character varying(10),
    sequence_category character varying(5),
    sequence_number character varying(20),
    branch_operation_no character varying(10),
    return_operation_no character varying(10),
    material_no character varying(50),
    material_description text,
    operation_description text,
    work_center character varying(30),
    cost_center character varying(30),
    plant_code character varying(10),
    unit_of_measure character varying(10),
    standard_value character varying(30),
    order_type character varying(10),
    order_description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status_etl character varying(10) DEFAULT 'NEW'::character varying
);

ALTER TABLE public.qh3_order ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.qh3_order_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.receiving_components (
    id integer NOT NULL,
    receiving_order_id integer NOT NULL,
    parent_component_id integer,
    part_level smallint NOT NULL,
    part_number character varying(100),
    part_description character varying(300),
    model_code character varying(50),
    part_type character varying(10),
    part_category_id integer,
    production_order character varying(100),
    actual_component character varying(100),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    component_id bigint
);

ALTER TABLE public.receiving_components ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.receiving_components_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.receiving_orders (
    id integer NOT NULL,
    ssbr_ident character varying(50),
    customer_id integer NOT NULL,
    received_date date NOT NULL,
    tagging_time timestamp with time zone,
    received_by_id integer,
    reff_number character varying(200),
    ex_unit character varying(100),
    packing_list character varying(200),
    da_ckb_received character varying(200),
    packing_type_id integer,
    raw_sow_text text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

ALTER TABLE public.receiving_orders ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.receiving_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.shipping_records (
    id integer NOT NULL,
    receiving_order_id integer NOT NULL,
    delivery_note_number character varying(100),
    send_by_id integer,
    destination character varying(200),
    consignment_notes character varying(200),
    shipping_list character varying(200),
    freight_cost_bill character varying(100),
    delivery_date date,
    return_to_stock_date date,
    dn_received_by_customer date,
    dn_received_by_ssb date,
    dn_submit_date date,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);

ALTER TABLE public.shipping_records ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.shipping_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE public.sow ALTER COLUMN idsow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_idsow_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sow_nnva_base (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.sow_nnva_base_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sow_nnva_base_id_seq OWNED BY public.sow_nnva_base.id;

CREATE TABLE public.sow_nnva_standard (
    id integer NOT NULL,
    sow_standard_id integer NOT NULL,
    nnva_base_id integer NOT NULL,
    standard_hours numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.sow_nnva_standard_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sow_nnva_standard_id_seq OWNED BY public.sow_nnva_standard.id;

CREATE TABLE public.sow_revision_history (
    id bigint NOT NULL,
    order_no text NOT NULL,
    revision_no integer NOT NULL,
    action text DEFAULT 'edit'::text NOT NULL,
    before_data jsonb,
    after_data jsonb,
    changed_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE public.sow_revision_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sow_revision_history_id_seq OWNED BY public.sow_revision_history.id;

CREATE TABLE public.sow_standard (
    id bigint NOT NULL,
    component_id bigint NOT NULL,
    operation_no integer NOT NULL,
    operation_text text NOT NULL,
    machineid text,
    workcenter text,
    std_hours numeric(10,2),
    source_plant integer
);

CREATE TABLE public.sow_standard_attachments (
    id bigint NOT NULL,
    standard_id bigint NOT NULL,
    filename text NOT NULL,
    original_name text NOT NULL,
    file_path text NOT NULL,
    file_size integer,
    uploaded_at timestamp with time zone DEFAULT now()
);

CREATE SEQUENCE public.sow_standard_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sow_standard_attachments_id_seq OWNED BY public.sow_standard_attachments.id;

ALTER TABLE public.sow_standard ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_standard_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sow_template_lines (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    standard_id bigint NOT NULL
);

ALTER TABLE public.sow_template_lines ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_template_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sow_templates (
    template_id bigint NOT NULL,
    component_id bigint NOT NULL,
    template_name text NOT NULL,
    created_by text,
    created_at timestamp without time zone DEFAULT now()
);

ALTER TABLE public.sow_templates ALTER COLUMN template_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_templates_template_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.timesheet_transaction (
    tsnumber integer NOT NULL,
    activitytype text,
    operation_text text,
    confirmationnumber text,
    ssbr_id text,
    date_checkin text,
    date_checkout text,
    full_name text,
    hour_checkin text,
    hour_checkout text,
    longdate_checkin timestamp with time zone,
    longdate_checkout timestamp with time zone,
    note text,
    part_name text,
    planhours numeric(10,2),
    plant text,
    serialnumber text,
    state_flag smallint DEFAULT 1,
    std_foreman_hours numeric(10,2),
    validation_date timestamp with time zone,
    workcentercode text,
    workcenterdescription text,
    duration numeric,
    operation_no integer,
    order_no text,
    modified_at timestamp without time zone DEFAULT now()
);

ALTER TABLE public.timesheet_transaction ALTER COLUMN tsnumber ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.timesheet_transaction_tsnumber_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.usernfc (
    idrow integer NOT NULL,
    nfcid text,
    full_name text,
    snssb text,
    machineid text,
    machinename text,
    workcenter text,
    roles text,
    mode character varying(10) DEFAULT 'single'::character varying
);

ALTER TABLE public.usernfc ALTER COLUMN idrow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.usernfc_idrow_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    role character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    roles character varying(50)
);

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.vw_sow_orders AS
 SELECT s.order_no,
    (array_agg(s.idsow ORDER BY s.operation_no))[1] AS idsow,
    (array_agg(s.ssbr_id ORDER BY s.operation_no))[1] AS ssbr_id,
    (array_agg(s.part_number ORDER BY s.operation_no))[1] AS part_number,
    (array_agg(s.part_name ORDER BY s.operation_no))[1] AS part_name,
    (array_agg(s.model ORDER BY s.operation_no))[1] AS model,
    (array_agg(s.customer ORDER BY s.operation_no))[1] AS customer,
    (array_agg(s.location ORDER BY s.operation_no))[1] AS location,
    (array_agg(s.type ORDER BY s.operation_no))[1] AS type,
    (array_agg(s."group" ORDER BY s.operation_no))[1] AS "group",
    (array_agg(s.category ORDER BY s.operation_no))[1] AS category,
    (array_agg(s.status ORDER BY s.operation_no))[1] AS status,
    (array_agg(s.systemstatus ORDER BY s.operation_no))[1] AS systemstatus,
    (array_agg(s.confirmation ORDER BY s.operation_no))[1] AS confirmation,
    (array_agg(s.created_by ORDER BY s.operation_no))[1] AS created_by,
    count(*) AS operation_count,
    COALESCE(sum(s.planhours), (0)::numeric) AS total_planhours,
    round(avg(
        CASE
            WHEN ((s.planhours IS NOT NULL) AND ((s.planhours)::numeric <> (0)::numeric) AND ((s.workcenter IS NULL) OR (s.workcenter !~~* '%OT%'::text))) THEN s.progress
            ELSE NULL::integer
        END), 1) AS avg_progress
   FROM public.sow s
  GROUP BY s.order_no;

CREATE TABLE public.workcenter (
    idrow integer NOT NULL,
    plant integer,
    workcenterot character varying(50),
    condition character varying(50),
    categoryhours character varying(50),
    groupname character varying(50),
    machineid character varying(50),
    "position" integer,
    costcenter integer,
    costcenter_rate integer,
    workcenter_description character varying(50),
    workcenternew character varying(50),
    workcenterold character varying(50)
);

ALTER TABLE public.workcenter ALTER COLUMN idrow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.workcenter_idrow_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE ONLY public.buffer_transaction ALTER COLUMN id SET DEFAULT nextval('public.buffer_transaction_id_seq'::regclass);

ALTER TABLE ONLY public.component_hours ALTER COLUMN id SET DEFAULT nextval('public.component_hours_id_seq'::regclass);

ALTER TABLE ONLY public.progress_update_history ALTER COLUMN id SET DEFAULT nextval('public.progress_update_history_id_seq'::regclass);

ALTER TABLE ONLY public.sow_nnva_base ALTER COLUMN id SET DEFAULT nextval('public.sow_nnva_base_id_seq'::regclass);

ALTER TABLE ONLY public.sow_nnva_standard ALTER COLUMN id SET DEFAULT nextval('public.sow_nnva_standard_id_seq'::regclass);

ALTER TABLE ONLY public.sow_revision_history ALTER COLUMN id SET DEFAULT nextval('public.sow_revision_history_id_seq'::regclass);

ALTER TABLE ONLY public.sow_standard_attachments ALTER COLUMN id SET DEFAULT nextval('public.sow_standard_attachments_id_seq'::regclass);

ALTER TABLE ONLY public.buffer_transaction
    ADD CONSTRAINT buffer_transaction_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_machine_id_component_id_component_label_key UNIQUE (machine_id, component_id, component_label);

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_model_part_number_key UNIQUE (model, part_number);

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_pkey PRIMARY KEY (component_id);

ALTER TABLE ONLY public.consumable_item
    ADD CONSTRAINT consumable_item_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.consumable_stock
    ADD CONSTRAINT consumable_stock_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT consumable_ticket_cis_no_key UNIQUE (cis_no);

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT consumable_ticket_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_name_site_name_key UNIQUE (name, site_name);

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.log_timesheet_sap
    ADD CONSTRAINT log_timesheet_sap_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mch_machines
    ADD CONSTRAINT mch_machines_pkey PRIMARY KEY (machineno);

ALTER TABLE ONLY public.mch_statustypes
    ADD CONSTRAINT mch_statustypes_pkey PRIMARY KEY (statusid);

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_part_id_operation_no_key UNIQUE (part_id, operation_no);

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT operations_pkey PRIMARY KEY (operation_id);

ALTER TABLE ONLY public.packing_types
    ADD CONSTRAINT packing_types_name_key UNIQUE (name);

ALTER TABLE ONLY public.packing_types
    ADD CONSTRAINT packing_types_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.part_categories
    ADD CONSTRAINT part_categories_name_key UNIQUE (name);

ALTER TABLE ONLY public.part_categories
    ADD CONSTRAINT part_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_partnumber_key UNIQUE (partnumber);

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (part_id);

ALTER TABLE ONLY public.ph3_order
    ADD CONSTRAINT ph3_order_confirmation_number_key UNIQUE (confirmation_number);

ALTER TABLE ONLY public.ph3_order
    ADD CONSTRAINT ph3_order_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.process_category
    ADD CONSTRAINT process_category_pkey PRIMARY KEY (id_process);

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT process_parameter_choicebase_pkey PRIMARY KEY (id_choice);

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT process_parameter_pkey PRIMARY KEY (id_parameter);

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT processcontroldata_item_pkey PRIMARY KEY (id_processcontroldata_item);

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT processcontroldata_pkey PRIMARY KEY (id_processcontroldata);

ALTER TABLE ONLY public.production_operations
    ADD CONSTRAINT production_operations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT progress_update_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT qh3_order_confirmation_number_key UNIQUE (confirmation_number);

ALTER TABLE ONLY public.qh3_order
    ADD CONSTRAINT qh3_order_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_ssbr_ident_key UNIQUE (ssbr_ident);

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_receiving_order_id_key UNIQUE (receiving_order_id);

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_codenumber_uniq UNIQUE (codenumber);

ALTER TABLE ONLY public.sow_nnva_base
    ADD CONSTRAINT sow_nnva_base_name_key UNIQUE (name);

ALTER TABLE ONLY public.sow_nnva_base
    ADD CONSTRAINT sow_nnva_base_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_sow_standard_id_nnva_base_id_key UNIQUE (sow_standard_id, nnva_base_id);

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_pkey PRIMARY KEY (idsow);

ALTER TABLE ONLY public.sow_revision_history
    ADD CONSTRAINT sow_revision_history_order_no_revision_no_key UNIQUE (order_no, revision_no);

ALTER TABLE ONLY public.sow_revision_history
    ADD CONSTRAINT sow_revision_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_pkey PRIMARY KEY (template_id);

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT timesheet_transaction_pkey PRIMARY KEY (tsnumber);

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT uq_sow_order_operation UNIQUE (order_no, operation_no);

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_pkey PRIMARY KEY (idrow);

ALTER TABLE ONLY public.usernfc
    ADD CONSTRAINT usernfc_snssb_unique UNIQUE (snssb);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_machineid_unique UNIQUE (machineid);

ALTER TABLE ONLY public.workcenter
    ADD CONSTRAINT workcenter_pkey PRIMARY KEY (idrow);

CREATE INDEX idx_buffer_transaction_box_priority ON public.buffer_transaction USING btree (machine_id, type, priority, created_at DESC);

CREATE INDEX idx_buffer_transaction_component ON public.buffer_transaction USING btree (component_id);

CREATE INDEX idx_buffer_transaction_history ON public.buffer_transaction USING btree (order_no, operation_no, created_at DESC);

CREATE INDEX idx_buffer_transaction_latest ON public.buffer_transaction USING btree (machine_id, order_no, operation_no, created_at DESC, id DESC);

CREATE INDEX idx_buffer_transaction_machine_time ON public.buffer_transaction USING btree (machine_id, "timestamp" DESC);

CREATE INDEX idx_buffer_transaction_order_operation ON public.buffer_transaction USING btree (machine_id, order_no, operation_no, created_at DESC);

CREATE INDEX idx_component_hours_machine ON public.component_hours USING btree (machine_id, total_hours DESC);

CREATE INDEX idx_consumable_item_cis_no ON public.consumable_item USING btree (cis_no);

CREATE INDEX idx_consumable_item_status ON public.consumable_item USING btree (status);

CREATE INDEX idx_consumable_stock_code_mm ON public.consumable_stock USING btree (code_mm);

CREATE INDEX idx_consumable_stock_description_trgm ON public.consumable_stock USING gin (material_description public.gin_trgm_ops);

CREATE INDEX idx_consumable_stock_material_code ON public.consumable_stock USING btree (material_code);

CREATE INDEX idx_consumable_ticket_sn_created ON public.consumable_ticket USING btree (sn_karyawan, created DESC);

CREATE INDEX idx_customers_name ON public.customers USING btree (name);

CREATE INDEX idx_customers_site ON public.customers USING btree (site_name);

CREATE INDEX idx_nnva_std_nnva_id ON public.sow_nnva_standard USING btree (nnva_base_id);

CREATE INDEX idx_nnva_std_sow_id ON public.sow_nnva_standard USING btree (sow_standard_id);

CREATE INDEX idx_operations_drawing_path ON public.operations USING btree (drawing_path);

CREATE INDEX idx_operations_part_id ON public.operations USING btree (part_id);

CREATE INDEX idx_parts_model ON public.parts USING btree (model);

CREATE INDEX idx_parts_partname ON public.parts USING btree (partname);

CREATE INDEX idx_parts_partnumber ON public.parts USING btree (partnumber);

CREATE INDEX idx_pcd_operation_no ON public.processcontroldata USING btree (operation_no);

CREATE INDEX idx_pcd_production_order ON public.processcontroldata USING btree (production_order);

CREATE INDEX idx_pcd_snssb ON public.processcontroldata USING btree (snssb);

CREATE INDEX idx_pcd_tsnumber ON public.processcontroldata USING btree (tsnumber);

CREATE INDEX idx_pcdi_id_parameter ON public.processcontroldata_item USING btree (id_parameter);

CREATE INDEX idx_pcdi_id_processcontroldata ON public.processcontroldata_item USING btree (id_processcontroldata);

CREATE INDEX idx_ph3_order_order_description ON public.ph3_order USING btree (order_no, order_description);

CREATE INDEX idx_pp_id_process ON public.process_parameter USING btree (id_process);

CREATE INDEX idx_ppcb_id_parameter ON public.process_parameter_choicebase USING btree (id_parameter);

CREATE INDEX idx_prodops_order_operation ON public.production_operations USING btree (order_number, operation_number);

CREATE INDEX idx_puh_created_at ON public.progress_update_history USING btree (created_at DESC);

CREATE INDEX idx_puh_operation_id ON public.progress_update_history USING btree (operation_id);

CREATE INDEX idx_rc_component_id ON public.receiving_components USING btree (component_id);

CREATE INDEX idx_rc_model_code ON public.receiving_components USING btree (model_code);

CREATE INDEX idx_rc_order ON public.receiving_components USING btree (receiving_order_id);

CREATE INDEX idx_rc_parent ON public.receiving_components USING btree (parent_component_id);

CREATE INDEX idx_rc_prod_order ON public.receiving_components USING btree (production_order);

CREATE INDEX idx_ro_customer_id ON public.receiving_orders USING btree (customer_id);

CREATE INDEX idx_ro_received_by ON public.receiving_orders USING btree (received_by_id);

CREATE INDEX idx_ro_received_date ON public.receiving_orders USING btree (received_date);

CREATE INDEX idx_ro_ssbr ON public.receiving_orders USING btree (ssbr_ident);

CREATE INDEX idx_sow_codenumber ON public.sow USING btree (codenumber);

CREATE INDEX idx_sow_model ON public.sow USING btree (model);

CREATE INDEX idx_sow_order_no ON public.sow USING btree (order_no);

CREATE INDEX idx_sow_part_name_trgm ON public.sow USING gin (part_name public.gin_trgm_ops);

CREATE INDEX idx_sow_part_number ON public.sow USING btree (part_number);

CREATE INDEX idx_sow_revision_history_order_created ON public.sow_revision_history USING btree (order_no, created_at DESC);

CREATE INDEX idx_sow_ssbr_id ON public.sow USING btree (ssbr_id);

CREATE INDEX idx_sow_standard_component_id ON public.sow_standard USING btree (component_id);

CREATE INDEX idx_sow_standard_source_plant ON public.sow_standard USING btree (source_plant);

CREATE INDEX idx_sow_std_attach_standard_id ON public.sow_standard_attachments USING btree (standard_id);

CREATE INDEX idx_sow_sync_modified ON public.sow USING btree (order_no, operation_no) WHERE (sync = 'modified'::text);

CREATE INDEX idx_sow_tmpl_lines_standard_id ON public.sow_template_lines USING btree (standard_id);

CREATE INDEX idx_sow_tmpl_lines_template_id ON public.sow_template_lines USING btree (template_id);

CREATE INDEX idx_sow_workcenter ON public.sow USING btree (workcenter);

CREATE INDEX idx_sr_delivery_date ON public.shipping_records USING btree (delivery_date);

CREATE INDEX idx_sr_order ON public.shipping_records USING btree (receiving_order_id);

CREATE INDEX idx_sr_send_by ON public.shipping_records USING btree (send_by_id);

CREATE INDEX idx_src_etl_plant ON public.ph3_order USING btree (plant_code, status_etl);

CREATE INDEX idx_timesheet_modified ON public.timesheet_transaction USING btree (modified_at);

CREATE INDEX idx_ts_component_tracking_active ON public.timesheet_transaction USING btree (workcentercode, longdate_checkout, longdate_checkin DESC) WHERE (longdate_checkin IS NOT NULL);

CREATE INDEX idx_ts_component_tracking_productive ON public.timesheet_transaction USING btree (workcentercode, order_no, operation_no, longdate_checkin) WHERE ((activitytype IS NULL) AND (longdate_checkin IS NOT NULL));

CREATE INDEX idx_ts_full_name_trgm ON public.timesheet_transaction USING gin (full_name public.gin_trgm_ops);

CREATE INDEX idx_ts_longdate_checkin ON public.timesheet_transaction USING btree (longdate_checkin);

CREATE INDEX idx_ts_longdate_checkout ON public.timesheet_transaction USING btree (longdate_checkout);

CREATE INDEX idx_ts_operation_no ON public.timesheet_transaction USING btree (operation_no);

CREATE INDEX idx_ts_order_no ON public.timesheet_transaction USING btree (order_no);

CREATE INDEX idx_ts_order_no_trgm ON public.timesheet_transaction USING gin (order_no public.gin_trgm_ops);

CREATE INDEX idx_ts_order_wc ON public.timesheet_transaction USING btree (order_no, workcentercode);

CREATE INDEX idx_ts_serial_checkin ON public.timesheet_transaction USING btree (serialnumber, longdate_checkin);

CREATE INDEX idx_ts_serialnumber ON public.timesheet_transaction USING btree (serialnumber);

CREATE INDEX idx_ts_serialnumber_trgm ON public.timesheet_transaction USING gin (serialnumber public.gin_trgm_ops);

CREATE INDEX idx_ts_state_flag ON public.timesheet_transaction USING btree (state_flag);

CREATE INDEX idx_ts_validation_date ON public.timesheet_transaction USING btree (validation_date);

CREATE INDEX idx_ts_workcentercode ON public.timesheet_transaction USING btree (workcentercode);

CREATE INDEX idx_users_role ON public.users USING btree (role);

CREATE INDEX idx_users_username ON public.users USING btree (username);

CREATE UNIQUE INDEX uq_usernfc_nfcid ON public.usernfc USING btree (nfcid);

CREATE TRIGGER before_update_set_sync BEFORE UPDATE ON public.sow FOR EACH ROW EXECUTE FUNCTION public.trg_set_sync_modified();

CREATE TRIGGER trg_delete_dup_sow AFTER INSERT ON public.sow FOR EACH ROW EXECUTE FUNCTION public.fn_delete_dup_sow();

CREATE TRIGGER trg_nnva_base_updated_at BEFORE UPDATE ON public.sow_nnva_base FOR EACH ROW EXECUTE FUNCTION public.update_nnva_updated_at();

CREATE TRIGGER trg_nnva_standard_updated_at BEFORE UPDATE ON public.sow_nnva_standard FOR EACH ROW EXECUTE FUNCTION public.update_nnva_updated_at();

CREATE TRIGGER trg_set_modified_at BEFORE UPDATE ON public.timesheet_transaction FOR EACH ROW EXECUTE FUNCTION public.set_modified_at();

CREATE TRIGGER update_operations_updated_at BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_parts_updated_at BEFORE UPDATE ON public.parts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE ONLY public.buffer_transaction
    ADD CONSTRAINT buffer_transaction_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.component_hours
    ADD CONSTRAINT component_hours_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.process_parameter_choicebase
    ADD CONSTRAINT fk_choice_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE CASCADE;

ALTER TABLE ONLY public.consumable_item
    ADD CONSTRAINT fk_consumable_item_ticket FOREIGN KEY (cis_no) REFERENCES public.consumable_ticket(cis_no) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY public.consumable_ticket
    ADD CONSTRAINT fk_consumable_ticket_user FOREIGN KEY (sn_karyawan) REFERENCES public.usernfc(snssb) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_parameter FOREIGN KEY (id_parameter) REFERENCES public.process_parameter(id_parameter) ON DELETE SET NULL;

ALTER TABLE ONLY public.processcontroldata_item
    ADD CONSTRAINT fk_item_processcontroldata FOREIGN KEY (id_processcontroldata) REFERENCES public.processcontroldata(id_processcontroldata) ON DELETE CASCADE;

ALTER TABLE ONLY public.operations
    ADD CONSTRAINT fk_operations_part FOREIGN KEY (part_id) REFERENCES public.parts(part_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.processcontroldata
    ADD CONSTRAINT fk_pcd_timesheet FOREIGN KEY (tsnumber) REFERENCES public.timesheet_transaction(tsnumber) ON DELETE SET NULL;

ALTER TABLE ONLY public.process_parameter
    ADD CONSTRAINT fk_pp_process_category FOREIGN KEY (id_process) REFERENCES public.process_category(id_process) ON DELETE CASCADE;

ALTER TABLE ONLY public.progress_update_history
    ADD CONSTRAINT fk_puh_sow_operation FOREIGN KEY (operation_id) REFERENCES public.sow(idsow) ON DELETE CASCADE;

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT fk_timesheet_user FOREIGN KEY (serialnumber) REFERENCES public.usernfc(snssb) ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_parent_component_id_fkey FOREIGN KEY (parent_component_id) REFERENCES public.receiving_components(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_part_category_id_fkey FOREIGN KEY (part_category_id) REFERENCES public.part_categories(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.receiving_components
    ADD CONSTRAINT receiving_components_receiving_order_id_fkey FOREIGN KEY (receiving_order_id) REFERENCES public.receiving_orders(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.receiving_orders
    ADD CONSTRAINT receiving_orders_packing_type_id_fkey FOREIGN KEY (packing_type_id) REFERENCES public.packing_types(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_receiving_order_id_fkey FOREIGN KEY (receiving_order_id) REFERENCES public.receiving_orders(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_nnva_base_id_fkey FOREIGN KEY (nnva_base_id) REFERENCES public.sow_nnva_base(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_sow_standard_id_fkey FOREIGN KEY (sow_standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id);

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.sow_templates(template_id);

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);

