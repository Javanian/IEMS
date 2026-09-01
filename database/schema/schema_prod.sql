
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

CREATE SCHEMA ews;

COMMENT ON SCHEMA public IS '';

CREATE SCHEMA rbac;

CREATE SCHEMA tools_management;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

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

CREATE FUNCTION public.generate_remaining_hours_notifications() RETURNS TABLE(notification_order_no text, action text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO tts_notifications
        (order_no, ssbr_id, part_name, total_planhours, total_actual_hours, remaining_hours, status)
    SELECT order_no, ssbr_id, part_name, total_planhours, total_actual_hours, remaining_hours, 'pending'
    FROM mv_order_remaining_hours
    WHERE is_exceeded = TRUE
    ON CONFLICT (order_no) DO UPDATE SET
        total_planhours = EXCLUDED.total_planhours,
        total_actual_hours = EXCLUDED.total_actual_hours,
        remaining_hours = EXCLUDED.remaining_hours,
        updated_at = CURRENT_TIMESTAMP;
    RETURN QUERY SELECT n.order_no, 'upserted'::TEXT
        FROM tts_notifications n WHERE n.updated_at > CURRENT_TIMESTAMP - INTERVAL '1 second';
END;
$$;

CREATE FUNCTION public.mch_transaction_freeze_posted() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  posted_ids bigint[];
BEGIN
  SELECT array_agg(DISTINCT s.staging_id)
    INTO posted_ids
    FROM public.sap_staging_source s
   WHERE s.source_system = 'MCH_HOURS'
     AND s.source_row_id = NEW.proddataid::text
     AND s.posted_at IS NOT NULL;

  IF posted_ids IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.order_no IS DISTINCT FROM OLD.order_no THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'order_no', OLD.order_no, NEW.order_no, posted_ids);
    NEW.order_no := OLD.order_no;
  END IF;

  IF NEW.operation_no IS DISTINCT FROM OLD.operation_no THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'operation_no', OLD.operation_no, NEW.operation_no, posted_ids);
    NEW.operation_no := OLD.operation_no;
  END IF;

  IF NEW.sn_employee IS DISTINCT FROM OLD.sn_employee THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'sn_employee', OLD.sn_employee, NEW.sn_employee, posted_ids);
    NEW.sn_employee := OLD.sn_employee;
  END IF;

  IF NEW.confirmation_number IS DISTINCT FROM OLD.confirmation_number THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'confirmation_number', OLD.confirmation_number, NEW.confirmation_number, posted_ids);
    NEW.confirmation_number := OLD.confirmation_number;
  END IF;

  IF NEW.machineid IS DISTINCT FROM OLD.machineid THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'machineid', OLD.machineid, NEW.machineid, posted_ids);
    NEW.machineid := OLD.machineid;
  END IF;

  IF NEW.status_activitytype IS DISTINCT FROM OLD.status_activitytype THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'status_activitytype', OLD.status_activitytype, NEW.status_activitytype, posted_ids);
    NEW.status_activitytype := OLD.status_activitytype;
  END IF;

  IF NEW.startdatetime IS DISTINCT FROM OLD.startdatetime THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'startdatetime', OLD.startdatetime::text, NEW.startdatetime::text, posted_ids);
    NEW.startdatetime := OLD.startdatetime;
  END IF;

  IF NEW.enddatetime IS DISTINCT FROM OLD.enddatetime THEN
    INSERT INTO public.sap_source_change_blocked (source_system, source_row_id, changed_field, old_value, new_value, staging_ids)
    VALUES ('MCH_HOURS', NEW.proddataid::text, 'enddatetime', OLD.enddatetime::text, NEW.enddatetime::text, posted_ids);
    NEW.enddatetime := OLD.enddatetime;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.mch_transaction_invalidate_pending_bundles() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  stale_ids bigint[];
BEGIN

  IF (NEW.order_no, NEW.operation_no, NEW.sn_employee, NEW.confirmation_number,
      NEW.machineid, NEW.status_activitytype, NEW.status_description,
      NEW.startdatetime, NEW.enddatetime)
     IS NOT DISTINCT FROM
     (OLD.order_no, OLD.operation_no, OLD.sn_employee, OLD.confirmation_number,
      OLD.machineid, OLD.status_activitytype, OLD.status_description,
      OLD.startdatetime, OLD.enddatetime)
  THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT s.staging_id)
    INTO stale_ids
    FROM public.sap_staging_source s
    JOIN public.sap_timesheet_staging t ON t.id = s.staging_id
   WHERE s.source_system = 'MCH_HOURS'
     AND s.source_row_id = NEW.proddataid::text
     AND s.posted_at IS NULL
     AND t.status IN ('PENDING', 'FAILED', 'SKIPPED');

  IF stale_ids IS NULL THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.sap_timesheet_staging WHERE id = ANY(stale_ids);

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.refresh_mv_kanban_order_board() RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  is_populated boolean;
BEGIN
  SELECT COALESCE(m.ispopulated, FALSE)
  INTO is_populated
  FROM pg_matviews m
  WHERE m.schemaname = 'public'
    AND m.matviewname = 'mv_kanban_order_board';

  IF NOT COALESCE(is_populated, FALSE) THEN
    REFRESH MATERIALIZED VIEW public.mv_kanban_order_board;
  ELSE
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_kanban_order_board;
  END IF;
END;
$$;

CREATE FUNCTION public.sap_staging_mark_segments_posted() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status IS DISTINCT FROM 'POSTED' THEN
    UPDATE public.sap_staging_source
       SET posted_at = COALESCE(NEW.posted_at, now())
     WHERE staging_id = NEW.id
       AND posted_at IS NULL;
  END IF;
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

CREATE FUNCTION public.set_ms_project_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

CREATE FUNCTION public.set_sow_scheduling_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.trg_set_sync_modified() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.sync = 'modified';
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

CREATE FUNCTION tools_management.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE ews.action_history (
    id bigint NOT NULL,
    action_id bigint,
    old_status text,
    new_status text,
    changed_by text,
    notes text,
    change_timestamp timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE ews.action_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE ews.action_history_id_seq OWNED BY ews.action_history.id;

CREATE TABLE ews.action_table (
    action_id bigint NOT NULL,
    alert_id bigint,
    kpi_type text NOT NULL,
    scope_type text NOT NULL,
    scope_key text NOT NULL,
    machine_id text,
    status_reason text,
    action_taken text,
    pic text NOT NULL,
    action_status text DEFAULT 'Open'::text NOT NULL,
    due_at timestamp with time zone,
    action_date timestamp with time zone DEFAULT now() NOT NULL,
    last_updated timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    issue_key text,
    issue_description text,
    error_type text,
    severity text DEFAULT 'Watch'::text NOT NULL,
    solved_date timestamp with time zone,
    escalation_level text DEFAULT 'PIC Monitor'::text NOT NULL,
    detail_json jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE SEQUENCE ews.action_table_action_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE ews.action_table_action_id_seq OWNED BY ews.action_table.action_id;

CREATE TABLE ews.activity_type_ref (
    activitytype text NOT NULL,
    description text NOT NULL,
    is_unproductive boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ews.adoption_bucket_snapshot (
    bucket_start timestamp with time zone NOT NULL,
    bucket_end timestamp with time zone NOT NULL,
    machine_key text NOT NULL,
    operator_key text DEFAULT ''::text NOT NULL,
    operator_name text,
    has_unidentified boolean DEFAULT false NOT NULL,
    has_timesheet_match boolean DEFAULT false NOT NULL,
    machine_event_count integer DEFAULT 0 NOT NULL,
    gap_type text,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ews.adoption_summary_snapshot (
    id bigint NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    grain text DEFAULT 'today'::text NOT NULL,
    expected_bucket_count integer DEFAULT 0 NOT NULL,
    covered_bucket_count integer DEFAULT 0 NOT NULL,
    missing_bucket_count integer DEFAULT 0 NOT NULL,
    unidentified_bucket_count integer DEFAULT 0 NOT NULL,
    machine_count integer DEFAULT 0 NOT NULL,
    operator_count integer DEFAULT 0 NOT NULL,
    adoption_pct numeric(10,4),
    detail_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    adoption_source text DEFAULT 'all'::text NOT NULL
);

CREATE SEQUENCE ews.adoption_summary_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE ews.adoption_summary_snapshot_id_seq OWNED BY ews.adoption_summary_snapshot.id;

CREATE TABLE ews.alert_log (
    id bigint NOT NULL,
    alert_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    window_start timestamp with time zone,
    window_end timestamp with time zone,
    scope_type text NOT NULL,
    scope_key text NOT NULL,
    machine_id text,
    operator_id text,
    kpi_type text NOT NULL,
    kpi_value numeric(10,4),
    threshold_value numeric(10,4),
    severity text NOT NULL,
    alert_status text DEFAULT 'OPEN'::text NOT NULL,
    alert_message text NOT NULL,
    suggested_action text,
    detail_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone
);

CREATE SEQUENCE ews.alert_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE ews.alert_log_id_seq OWNED BY ews.alert_log.id;

CREATE TABLE ews.device_heartbeat_daily (
    work_date date NOT NULL,
    device_id text NOT NULL,
    beats bigint DEFAULT 0 NOT NULL,
    interval_sec integer DEFAULT 60 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ews.issue_log (
    id bigint NOT NULL,
    issue_key text NOT NULL,
    category text NOT NULL,
    business_date date NOT NULL,
    scope_type text,
    entity_id text,
    entity_name text,
    severity text DEFAULT 'warning'::text NOT NULL,
    title text,
    description text,
    metric_value numeric,
    detail jsonb,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolution_note text,
    resolved_by text,
    CONSTRAINT issue_log_resolution_note_required CHECK (((status <> 'resolved'::text) OR (NULLIF(btrim(resolution_note), ''::text) IS NOT NULL))),
    CONSTRAINT issue_log_severity_check CHECK ((severity = ANY (ARRAY['warning'::text, 'critical'::text]))),
    CONSTRAINT issue_log_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);

CREATE SEQUENCE ews.issue_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE ews.issue_log_id_seq OWNED BY ews.issue_log.id;

CREATE TABLE ews.kpi_snapshot (
    id bigint NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    grain text DEFAULT '15m'::text NOT NULL,
    scope_type text DEFAULT 'system'::text NOT NULL,
    scope_key text DEFAULT 'ALL'::text NOT NULL,
    shift_id bigint DEFAULT 0 NOT NULL,
    uptime_pct numeric(10,4),
    accuracy_pct numeric(10,4),
    adoption_pct numeric(10,4),
    oee_pct numeric(10,4),
    ole_pct numeric(10,4),
    overall_score numeric(10,4),
    overall_status text NOT NULL,
    detail_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE ews.kpi_snapshot_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE ews.kpi_snapshot_id_seq OWNED BY ews.kpi_snapshot.id;

CREATE TABLE ews.kpi_threshold (
    kpi_type text NOT NULL,
    normal_min numeric(10,4),
    warning_min numeric(10,4),
    critical_below numeric(10,4),
    owner text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ews.machine_heartbeat_daily (
    work_date date NOT NULL,
    machineno integer NOT NULL,
    pings bigint DEFAULT 0 NOT NULL,
    up_pings bigint DEFAULT 0 NOT NULL,
    uptime_pct numeric(6,2),
    avg_heartbeat numeric,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ews.operator_rotation_group (
    serialnumber text NOT NULL,
    rotation_group text NOT NULL,
    source text DEFAULT 'auto'::text NOT NULL,
    effective_from date NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operator_rotation_group_rotation_group_check CHECK ((rotation_group = ANY (ARRAY['A'::text, 'B'::text]))),
    CONSTRAINT operator_rotation_group_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'manual'::text])))
);

CREATE TABLE ews.operator_shift (
    shift_code text NOT NULL,
    shift_name text NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    crosses_midnight boolean DEFAULT false NOT NULL,
    standard_hours numeric NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE ews.operator_shift_lock (
    id bigint NOT NULL,
    serialnumber text NOT NULL,
    locked_shift text NOT NULL,
    effective_from date NOT NULL,
    lock_weeks integer NOT NULL,
    lock_end date NOT NULL,
    created_by text NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operator_shift_lock_end_after_start CHECK ((lock_end > effective_from)),
    CONSTRAINT operator_shift_lock_lock_weeks_check CHECK ((lock_weeks > 0))
);

ALTER TABLE ews.operator_shift_lock ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ews.operator_shift_lock_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ews.shift_roster (
    serialnumber text NOT NULL,
    business_date date NOT NULL,
    scheduled_shift text,
    scheduled_standard_hours numeric,
    status text DEFAULT 'SCHEDULED'::text NOT NULL,
    source text DEFAULT 'auto'::text NOT NULL,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shift_roster_source_check CHECK ((source = ANY (ARRAY['auto'::text, 'manual'::text]))),
    CONSTRAINT shift_roster_status_check CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'OFF'::text, 'LEAVE'::text, 'SICK'::text, 'PERMIT'::text])))
);

CREATE TABLE public.usernfc (
    idrow integer NOT NULL,
    nfcid text,
    full_name text,
    snssb text NOT NULL,
    machineid text,
    machinename text,
    workcenter text,
    roles text,
    mode character varying(10) DEFAULT 'single'::character varying,
    employee_category character varying(10),
    inactive_from date
);

CREATE VIEW ews.roster_effective AS
 SELECT r.serialnumber,
    r.business_date,
    r.status,
    r.source,
    r.updated_by,
    COALESCE(lk.locked_shift, r.scheduled_shift) AS eff_shift,
    COALESCE(os_lk.standard_hours, r.scheduled_standard_hours) AS eff_std,
    (lk.id IS NOT NULL) AS shift_locked
   FROM (((ews.shift_roster r
     LEFT JOIN ews.operator_shift_lock lk ON (((lk.serialnumber = r.serialnumber) AND (lk.cancelled_at IS NULL) AND (daterange(lk.effective_from, lk.lock_end, '[)'::text) @> r.business_date))))
     LEFT JOIN ews.operator_shift os_lk ON ((os_lk.shift_code = lk.locked_shift)))
     LEFT JOIN public.usernfc u ON ((NULLIF(btrim(u.snssb), ''::text) = r.serialnumber)))
  WHERE ((u.inactive_from IS NULL) OR (r.business_date < u.inactive_from));

CREATE TABLE ews.roster_workday_rule (
    day_of_week integer NOT NULL,
    runs_day boolean DEFAULT false NOT NULL,
    runs_night boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roster_workday_rule_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);

CREATE TABLE ews.rotation_config (
    id bigint NOT NULL,
    anchor_week_start date NOT NULL,
    anchor_group_a_shift text NOT NULL,
    rotation_period_weeks integer DEFAULT 1 NOT NULL,
    week_start_dow integer DEFAULT 0 NOT NULL,
    effective_from date NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rotation_config_anchor_group_a_shift_check CHECK ((anchor_group_a_shift = ANY (ARRAY['DAY'::text, 'NIGHT'::text])))
);

ALTER TABLE ews.rotation_config ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ews.rotation_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE ews.tts_notification (
    id bigint NOT NULL,
    issue_key text,
    kpi_type text,
    severity text,
    title text,
    message text NOT NULL,
    path_mp3 text,
    generation_status text DEFAULT 'queued'::text NOT NULL,
    error_message text,
    attempts integer DEFAULT 0 NOT NULL,
    played boolean DEFAULT false NOT NULL,
    log_audio jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    generated_at timestamp with time zone
);

ALTER TABLE ews.tts_notification ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ews.tts_notification_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

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
    CONSTRAINT buffer_transaction_type_check CHECK ((type = ANY (ARRAY['in'::text, 'out'::text, 'moving'::text, 'shipment'::text])))
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
    material_code text NOT NULL,
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

CREATE TABLE public.device_status (
    device_id text NOT NULL,
    device_name text,
    model text,
    app_version text,
    android_version text,
    battery_pct smallint,
    charging boolean DEFAULT false NOT NULL,
    ip text,
    interval_sec integer DEFAULT 60 NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
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

CREATE TABLE public.mch_machine_ping_log (
    id bigint NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    machineid character varying(100),
    machinename character varying(255),
    ipaddress character varying(100) NOT NULL,
    ping_count integer NOT NULL,
    success_count integer NOT NULL,
    failed_count integer NOT NULL,
    min_latency_ms numeric(10,2),
    avg_latency_ms numeric(10,2),
    max_latency_ms numeric(10,2),
    packet_loss_percent numeric(5,2) NOT NULL,
    status character varying(20) NOT NULL,
    raw_results jsonb NOT NULL,
    machineids jsonb DEFAULT '[]'::jsonb NOT NULL,
    machine_count integer DEFAULT 1 NOT NULL
);

CREATE SEQUENCE public.mch_machine_ping_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.mch_machine_ping_log_id_seq OWNED BY public.mch_machine_ping_log.id;

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

CREATE TABLE public.mch_transaction (
    proddataid integer NOT NULL,
    startdatetime timestamp without time zone,
    enddatetime timestamp without time zone,
    work_date date,
    start_time text,
    end_time text,
    source_duration integer,
    duration_seconds bigint,
    duration_hours numeric,
    machineno integer,
    sitemachineno integer,
    machinegroupid integer,
    machine_plantid integer,
    machinetypeid integer,
    machineid character varying,
    machinename character varying,
    statusid smallint,
    previoustatusid smallint,
    status_description character varying,
    status_activitytype character varying,
    previous_status_description character varying(100),
    confirmation_number character varying(20),
    order_no character varying(20),
    operation_no character varying(10),
    operation_short_text text,
    operation_description text,
    sequence_category character varying(5),
    sequence_number character varying(20),
    branch_operation_no character varying(10),
    return_operation_no character varying(10),
    cost_center character varying(30),
    material_no character varying(50),
    material_description text,
    ssbr_id text,
    full_name text,
    sn_employee text,
    workcentercode text,
    tsnumber integer,
    checkin timestamp with time zone,
    refreshed_at timestamp with time zone,
    finish_job boolean,
    status_record boolean GENERATED ALWAYS AS (((statusid = ANY (ARRAY[0, 3, 4])) OR (((status_activitytype)::text = ANY (ARRAY[('M1'::character varying)::text, ('M2'::character varying)::text])) AND (NULLIF(btrim((order_no)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim((operation_no)::text), ''::text) IS NOT NULL) AND (NULLIF(btrim(sn_employee), ''::text) IS NOT NULL) AND (NULLIF(btrim((confirmation_number)::text), ''::text) IS NOT NULL)) OR ((NULLIF(btrim((status_activitytype)::text), ''::text) IS NOT NULL) AND ((status_activitytype)::text <> ALL (ARRAY[('M1'::character varying)::text, ('M2'::character varying)::text])) AND (NULLIF(btrim(sn_employee), ''::text) IS NOT NULL)))) STORED,
    end_effective timestamp without time zone,
    overlap_seconds integer DEFAULT 0 NOT NULL,
    is_stuck boolean DEFAULT false NOT NULL
);

CREATE TABLE public.mch_transaction_override (
    proddataid bigint NOT NULL,
    order_no text,
    operation_no text,
    sn_employee text,
    note text,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mch_transaction_override_something CHECK (((order_no IS NOT NULL) OR (sn_employee IS NOT NULL)))
);

CREATE TABLE public.mch_user (
    operatorid character varying(100) NOT NULL,
    full_name text,
    sn_employee text NOT NULL
);

CREATE TABLE public.ms_project (
    project_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_name text NOT NULL,
    description text,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    source_type text DEFAULT 'MS_PROJECT'::text,
    revision_no integer DEFAULT 1 NOT NULL,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_name text,
    project_owner text,
    order_status text,
    project_status text,
    published_revision_no integer,
    last_published_at timestamp with time zone,
    checked_out_by text,
    checked_out_at timestamp with time zone,
    calendar_id uuid,
    calendar_name text,
    file_path text,
    file_name text,
    file_size bigint,
    file_uploaded_at timestamp with time zone
);

COMMENT ON COLUMN public.ms_project.order_status IS 'OI / FOI';

COMMENT ON COLUMN public.ms_project.project_status IS 'HOLD, ON PROGRESS, CANCEL, RTD, COMMISIONING, COMPLETE, MTS, MTO';

CREATE TABLE public.ms_project_assignment (
    assignment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    assignment_units numeric(10,2) DEFAULT 1 NOT NULL,
    planned_work_minutes integer,
    actual_work_minutes integer,
    actual_start timestamp with time zone,
    actual_finish timestamp with time zone,
    assignment_start timestamp with time zone,
    assignment_finish timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    local_assignment_uid text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_assignment_units_positive CHECK ((assignment_units > (0)::numeric))
);

CREATE TABLE public.ms_project_audit_log (
    audit_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    action text NOT NULL,
    actor text,
    lock_token text,
    revision_no integer,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ms_project_bay_schedule (
    schedule_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_no text,
    project_id uuid,
    task_id uuid,
    area_code text NOT NULL,
    area_name text NOT NULL,
    bay_codes text[] NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text DEFAULT 'RESERVED'::text NOT NULL,
    notes text,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    booking_type text DEFAULT 'ORDER'::text NOT NULL,
    purpose text,
    schedule_group_id uuid,
    CONSTRAINT chk_bay_schedule_booking_type CHECK ((booking_type = ANY (ARRAY['ORDER'::text, 'PARKING'::text, 'STORAGE'::text, 'MAINTENANCE'::text, 'OTHER'::text]))),
    CONSTRAINT chk_bay_schedule_order_or_purpose CHECK ((((booking_type = 'ORDER'::text) AND (order_no IS NOT NULL) AND (btrim(order_no) <> ''::text)) OR ((booking_type <> 'ORDER'::text) AND (purpose IS NOT NULL) AND (btrim(purpose) <> ''::text)))),
    CONSTRAINT chk_ms_project_bay_schedule_bays_not_empty CHECK ((array_length(bay_codes, 1) > 0)),
    CONSTRAINT chk_ms_project_bay_schedule_status CHECK ((status = ANY (ARRAY['RESERVED'::text, 'CONFIRMED'::text, 'DONE'::text, 'CANCELLED'::text]))),
    CONSTRAINT chk_ms_project_bay_schedule_window CHECK ((end_date >= start_date))
);

COMMENT ON COLUMN public.ms_project_bay_schedule.booking_type IS 'Jenis pemakaian bay: ORDER (reservasi job, wajib order_no) atau PARKING/STORAGE/MAINTENANCE/OTHER (booking non-job, wajib purpose). Default ORDER agar baris lama tetap valid.';

COMMENT ON COLUMN public.ms_project_bay_schedule.purpose IS 'Keterangan tujuan pemakaian bay. WAJIB bila booking_type <> ''ORDER'' (lihat chk_bay_schedule_order_or_purpose); opsional sebagai catatan bebas untuk booking ORDER.';

COMMENT ON COLUMN public.ms_project_bay_schedule.schedule_group_id IS 'Identitas satu reservasi = N baris jadwal (satu per task). Dipakai endpoint PUT/DELETE /ms-project/bay-schedules/group/:schedule_group_id agar ubah & batal jadi atomik satu transaksi. Baris lama di-backfill per kelompok (order_no, start_date, end_date, bay_codes) — kunci yang dulu dirangkai ulang FE sebagai reservationKey.';

CREATE TABLE public.ms_project_calendar (
    calendar_id uuid DEFAULT gen_random_uuid() NOT NULL,
    calendar_code text NOT NULL,
    calendar_name text NOT NULL,
    calendar_scope text DEFAULT 'BASE'::text NOT NULL,
    base_calendar_id uuid,
    calendar_guid uuid,
    is_enterprise boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    hours_per_day numeric(10,2) DEFAULT 8 NOT NULL,
    hours_per_week numeric(10,2) DEFAULT 40 NOT NULL,
    days_per_month numeric(10,2) DEFAULT 20 NOT NULL,
    default_start_time time without time zone DEFAULT '08:00:00'::time without time zone NOT NULL,
    default_finish_time time without time zone DEFAULT '17:00:00'::time without time zone NOT NULL,
    timezone text DEFAULT 'Asia/Jakarta'::text NOT NULL,
    description text,
    source_type text DEFAULT 'MPS'::text NOT NULL,
    source_ref_id text,
    version_no integer DEFAULT 1 NOT NULL,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_calendar_hours_positive CHECK (((hours_per_day > (0)::numeric) AND (hours_per_week > (0)::numeric) AND (days_per_month > (0)::numeric))),
    CONSTRAINT chk_ms_project_calendar_scope CHECK ((calendar_scope = ANY (ARRAY['BASE'::text, 'PROJECT'::text, 'RESOURCE'::text, 'TASK'::text]))),
    CONSTRAINT chk_ms_project_calendar_version_positive CHECK ((version_no > 0))
);

CREATE TABLE public.ms_project_calendar_exception (
    exception_id uuid DEFAULT gen_random_uuid() NOT NULL,
    calendar_id uuid NOT NULL,
    exception_name text NOT NULL,
    exception_type text DEFAULT 'NON_WORKING'::text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    recurrence_rule jsonb,
    priority integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_calendar_exception_type CHECK ((exception_type = ANY (ARRAY['WORKING'::text, 'NON_WORKING'::text, 'REDUCED_WORKING'::text]))),
    CONSTRAINT chk_ms_project_calendar_exception_window CHECK ((end_date >= start_date))
);

CREATE TABLE public.ms_project_calendar_exception_time (
    exception_time_id uuid DEFAULT gen_random_uuid() NOT NULL,
    exception_id uuid NOT NULL,
    segment_no integer DEFAULT 1 NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    crosses_midnight boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_calendar_exception_time_segment CHECK (((segment_no >= 1) AND (segment_no <= 5)))
);

CREATE TABLE public.ms_project_calendar_weekday (
    calendar_weekday_id uuid DEFAULT gen_random_uuid() NOT NULL,
    calendar_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    day_type text DEFAULT 'WORKING'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_calendar_weekday_dow CHECK (((day_of_week >= 1) AND (day_of_week <= 7))),
    CONSTRAINT chk_ms_project_calendar_weekday_type CHECK ((day_type = ANY (ARRAY['WORKING'::text, 'NON_WORKING'::text, 'DEFAULT'::text])))
);

CREATE TABLE public.ms_project_calendar_working_time (
    working_time_id uuid DEFAULT gen_random_uuid() NOT NULL,
    calendar_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    segment_no integer DEFAULT 1 NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    crosses_midnight boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_calendar_working_time_dow CHECK (((day_of_week >= 1) AND (day_of_week <= 7))),
    CONSTRAINT chk_ms_project_calendar_working_time_segment CHECK (((segment_no >= 1) AND (segment_no <= 5)))
);

CREATE TABLE public.ms_project_dependency (
    dependency_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    predecessor_task_id uuid NOT NULL,
    successor_task_id uuid NOT NULL,
    dependency_type text,
    lag_minutes integer,
    local_dependency_key text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ms_project_lock (
    lock_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    lock_token text NOT NULL,
    locked_by text NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_lock_expiry CHECK ((expires_at > locked_at))
);

CREATE TABLE public.ms_project_publish (
    publish_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    revision_no integer NOT NULL,
    snapshot jsonb NOT NULL,
    published_by text,
    published_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ms_project_resource (
    project_resource_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ms_project_resource_availability (
    availability_id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_id uuid NOT NULL,
    available_from date,
    available_to date,
    max_units numeric(10,4) DEFAULT 1 NOT NULL,
    calendar_id uuid,
    source_type text DEFAULT 'MPS'::text NOT NULL,
    source_ref_id text,
    notes text,
    created_by text,
    updated_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_resource_availability_units CHECK ((max_units > (0)::numeric)),
    CONSTRAINT chk_ms_project_resource_availability_window CHECK (((available_to IS NULL) OR (available_from IS NULL) OR (available_to >= available_from)))
);

CREATE TABLE public.ms_project_revision (
    revision_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    revision_no integer NOT NULL,
    revision_type text NOT NULL,
    snapshot jsonb NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ms_project_revision_type CHECK ((revision_type = ANY (ARRAY['CREATE'::text, 'SYNC'::text, 'PUBLISH'::text, 'FORCE_CHECKIN'::text])))
);

CREATE TABLE public.ms_project_task (
    task_id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    parent_task_id uuid,
    task_name text NOT NULL,
    outline_level integer,
    outline_number text,
    order_no text,
    operation_no text,
    ssbr_id text,
    sow_id integer,
    workcenter text,
    plan_start timestamp with time zone,
    plan_finish timestamp with time zone,
    duration_minutes integer,
    planned_work_minutes integer,
    actual_start timestamp with time zone,
    actual_finish timestamp with time zone,
    actual_work_minutes integer,
    actual_progress numeric(5,2),
    actual_source text,
    actual_updated_at timestamp with time zone,
    is_summary boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    local_task_uid text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calendar_id uuid,
    calendar_name text,
    ignore_resource_calendar boolean DEFAULT false NOT NULL
);

CREATE TABLE public.ms_resource (
    resource_id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_code text NOT NULL,
    resource_name text NOT NULL,
    resource_type text DEFAULT 'WORK'::text NOT NULL,
    resource_category text NOT NULL,
    source_type text NOT NULL,
    source_ref_id text,
    employee_id text,
    machine_id text,
    workcenter_code text,
    parent_resource_id uuid,
    max_units numeric(10,2) DEFAULT 1 NOT NULL,
    is_assignable boolean DEFAULT true NOT NULL,
    is_generic boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calendar_id uuid,
    calendar_name text,
    CONSTRAINT chk_ms_resource_category CHECK ((resource_category = ANY (ARRAY['PERSON'::text, 'MACHINE'::text, 'WORKCENTER'::text, 'TEAM'::text, 'MATERIAL'::text]))),
    CONSTRAINT chk_ms_resource_max_units_positive CHECK ((max_units > (0)::numeric)),
    CONSTRAINT chk_ms_resource_type CHECK ((resource_type = ANY (ARRAY['WORK'::text, 'MATERIAL'::text, 'COST'::text])))
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
    revision_no integer DEFAULT 0 NOT NULL,
    source_op_id bigint,
    people_required smallint,
    CONSTRAINT chk_sow_actual_progress CHECK (((actual_progress IS NULL) OR ((actual_progress >= (0)::numeric) AND (actual_progress <= (100)::numeric)))),
    CONSTRAINT chk_sow_progress CHECK (((progress IS NULL) OR ((progress >= 0) AND (progress <= 100)))),
    CONSTRAINT sow_people_required_positive CHECK (((people_required IS NULL) OR (people_required > 0)))
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
    modified_at timestamp without time zone DEFAULT now(),
    ms_area_code text,
    ms_bay_codes text[],
    ms_task_id uuid,
    ms_project_id uuid,
    ms_bay_schedule_id uuid
);

COMMENT ON COLUMN public.timesheet_transaction.ms_area_code IS 'Manufacturing device-area code of the bay reservation this check-in came from (e.g. AREA-18). From selectedactivity.manufacturing_area_code. NULL for salvaging / non-reservation check-ins.';

COMMENT ON COLUMN public.timesheet_transaction.ms_bay_codes IS 'Bay codes of the reservation the operator checked in under. From selectedactivity.manufacturing_bay_codes (schedule bays), falling back to [manufacturing_bay_code].';

COMMENT ON COLUMN public.timesheet_transaction.ms_task_id IS 'Linked ms_project_task.task_id when the Select Job row resolved to a specific task; NULL for order-level reservations. Type matches ms_project_task PK (uuid).';

COMMENT ON COLUMN public.timesheet_transaction.ms_project_id IS 'Linked ms_project.project_id for the reservation/task. Type matches ms_project_task PK (uuid).';

COMMENT ON COLUMN public.timesheet_transaction.ms_bay_schedule_id IS 'Source ms_project_bay_schedule.schedule_id (the reservation that produced this job). No FK — reservations are cancellable. Used to flip RESERVED -> CONFIRMED on check-in.';

CREATE VIEW public.v_kanban_teco_orders AS
 SELECT DISTINCT ltrim((COALESCE(po.order_no, ''::character varying))::text, '0'::text) AS order_key
   FROM public.ph3_order po
  WHERE (((COALESCE(po.order_no, ''::character varying))::text <> ''::text) AND (COALESCE(po.order_description, ''::text) ~~* '%TECO%'::text));

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
    workcenterold character varying(50),
    location text
);

CREATE VIEW public.v_kanban_queue_candidates AS
 WITH active_buffer AS (
         SELECT b_1.id,
            b_1.order_no,
            ltrim(COALESCE(b_1.order_no, ''::text), '0'::text) AS order_key,
            b_1.ssbr_id,
            b_1.operation_no,
            b_1.operation_text,
            b_1.machine_id,
            b_1.type,
            b_1.priority,
            b_1."timestamp"
           FROM public.buffer_transaction b_1
          WHERE ((b_1.type = ANY (ARRAY['in'::text, 'moving'::text])) AND (COALESCE(b_1.order_no, ''::text) <> ''::text))
        ), buffer_with_machine AS (
         SELECT b_1.id,
            b_1.order_no,
            b_1.order_key,
            b_1.ssbr_id,
            b_1.operation_no,
            b_1.operation_text,
            b_1.machine_id,
            b_1.type,
            b_1.priority,
            b_1."timestamp",
            w.machineid,
            COALESCE(NULLIF((w.workcenternew)::text, ''::text), NULLIF((w.machineid)::text, ''::text), NULLIF((w.workcenterold)::text, ''::text), NULLIF((w.workcenterot)::text, ''::text)) AS machine_code,
            w.workcenter_description,
            w.location,
                CASE COALESCE(w.location, ''::text)
                    WHEN 'Incoming / Pre-Process'::text THEN 1
                    WHEN 'Cutting / Weld Repair'::text THEN 2
                    WHEN 'Rough Machining'::text THEN 3
                    WHEN 'Precision Machining'::text THEN 4
                    WHEN 'Surface Treatment / Coating'::text THEN 5
                    WHEN 'Inspection / Test'::text THEN 6
                    WHEN 'Packing / Ready Dispatch'::text THEN 7
                    WHEN 'Support'::text THEN 8
                    ELSE 0
                END AS lane_rank
           FROM (active_buffer b_1
             LEFT JOIN public.workcenter w ON (((w.machineid)::text = b_1.machine_id)))
        )
 SELECT b.order_key,
    b.order_no,
    'queue'::text AS current_source,
    COALESCE(NULLIF(b.location, ''::text), 'Unassigned'::text) AS current_location,
    b.lane_rank,
    b.machineid AS machine_id,
    b.machine_code,
    b.workcenter_description AS machine_description,
    b.operation_no,
    COALESCE(NULLIF(b.operation_text, ''::text), s.operation_text) AS operation_text,
    COALESCE(NULLIF(s.part_name, ''::text), NULLIF(t.part_name, ''::text)) AS part_name,
    COALESCE(NULLIF(b.ssbr_id, ''::text), NULLIF(s.ssbr_id, ''::text), NULLIF(t.ssbr_id, ''::text)) AS ssbr_id,
    'queued'::text AS current_state,
    b."timestamp" AS state_entered_at,
    b."timestamp" AS last_movement_at,
    round((EXTRACT(epoch FROM (now() - b."timestamp")) / 60.0), 2) AS state_age_minutes,
    NULL::numeric AS runtime_minutes,
    COALESCE(b.priority, 0) AS queue_priority,
    t.tsnumber AS evidence_tsnumber,
    b.id AS evidence_buffer_id,
    s.operation_no AS evidence_sow_operation_no,
    b."timestamp" AS event_ts
   FROM ((buffer_with_machine b
     LEFT JOIN LATERAL ( SELECT s_1.idsow,
            s_1.order_no,
            s_1.operation_no,
            s_1.ssbr_id,
            s_1.part_number,
            s_1.part_name,
            s_1.model,
            s_1.customer,
            s_1.location,
            s_1.wct_group,
            s_1.workcenter,
            s_1.operation_text,
            s_1.workcenterdescription,
            s_1.planhours,
            s_1.systemstatus,
            s_1.confirmation,
            s_1.status,
            s_1.finish_date,
            s_1.codenumber,
            s_1.weight,
            s_1.created_by,
            s_1.type,
            s_1."group",
            s_1.category,
            s_1.remark,
            s_1.sync,
            s_1.plan_start,
            s_1.plan_finish,
            s_1.actual_start,
            s_1.actual_finish,
            s_1.actual_progress,
            s_1.actual_hours,
            s_1.created_at,
            s_1.updated_at,
            s_1.progress,
            s_1.revision_no
           FROM public.sow s_1
          WHERE ((ltrim(COALESCE(s_1.order_no, ''::text), '0'::text) = b.order_key) AND ((b.operation_no IS NULL) OR (s_1.operation_no = b.operation_no)))
          ORDER BY s_1.idsow DESC
         LIMIT 1) s ON (true))
     LEFT JOIN LATERAL ( SELECT t_1.tsnumber,
            t_1.activitytype,
            t_1.operation_text,
            t_1.confirmationnumber,
            t_1.ssbr_id,
            t_1.date_checkin,
            t_1.date_checkout,
            t_1.full_name,
            t_1.hour_checkin,
            t_1.hour_checkout,
            t_1.longdate_checkin,
            t_1.longdate_checkout,
            t_1.note,
            t_1.part_name,
            t_1.planhours,
            t_1.plant,
            t_1.serialnumber,
            t_1.state_flag,
            t_1.std_foreman_hours,
            t_1.validation_date,
            t_1.workcentercode,
            t_1.workcenterdescription,
            t_1.duration,
            t_1.operation_no,
            t_1.order_no,
            t_1.modified_at
           FROM public.timesheet_transaction t_1
          WHERE ((ltrim(COALESCE(t_1.order_no, ''::text), '0'::text) = b.order_key) AND ((b.operation_no IS NULL) OR (t_1.operation_no = b.operation_no)))
          ORDER BY t_1.longdate_checkin DESC NULLS LAST, t_1.tsnumber DESC
         LIMIT 1) t ON (true))
  WHERE ((b.order_key <> ''::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.v_kanban_teco_orders teco
          WHERE (teco.order_key = b.order_key)))));

CREATE VIEW public.v_kanban_running_candidates AS
 WITH active_timesheet AS (
         SELECT t_1.tsnumber,
            t_1.order_no,
            ltrim(COALESCE(t_1.order_no, ''::text), '0'::text) AS order_key,
            t_1.operation_no,
            t_1.operation_text,
            t_1.part_name,
            t_1.ssbr_id,
            t_1.workcentercode,
            t_1.longdate_checkin,
            t_1.longdate_checkout
           FROM public.timesheet_transaction t_1
          WHERE ((t_1.longdate_checkin IS NOT NULL) AND (t_1.longdate_checkout IS NULL) AND (COALESCE(t_1.order_no, ''::text) <> ''::text))
        ), timesheet_with_machine AS (
         SELECT t_1.tsnumber,
            t_1.order_no,
            t_1.order_key,
            t_1.operation_no,
            t_1.operation_text,
            t_1.part_name,
            t_1.ssbr_id,
            t_1.workcentercode,
            t_1.longdate_checkin,
            t_1.longdate_checkout,
            w.machineid,
            COALESCE(NULLIF((w.workcenternew)::text, ''::text), NULLIF((w.machineid)::text, ''::text), NULLIF((w.workcenterold)::text, ''::text), NULLIF((w.workcenterot)::text, ''::text)) AS machine_code,
            w.workcenter_description,
            w.location,
                CASE COALESCE(w.location, ''::text)
                    WHEN 'Incoming / Pre-Process'::text THEN 1
                    WHEN 'Cutting / Weld Repair'::text THEN 2
                    WHEN 'Rough Machining'::text THEN 3
                    WHEN 'Precision Machining'::text THEN 4
                    WHEN 'Surface Treatment / Coating'::text THEN 5
                    WHEN 'Inspection / Test'::text THEN 6
                    WHEN 'Packing / Ready Dispatch'::text THEN 7
                    WHEN 'Support'::text THEN 8
                    ELSE 0
                END AS lane_rank
           FROM (active_timesheet t_1
             LEFT JOIN LATERAL ( SELECT w_1.idrow,
                    w_1.plant,
                    w_1.workcenterot,
                    w_1.condition,
                    w_1.categoryhours,
                    w_1.groupname,
                    w_1.machineid,
                    w_1."position",
                    w_1.costcenter,
                    w_1.costcenter_rate,
                    w_1.workcenter_description,
                    w_1.workcenternew,
                    w_1.workcenterold,
                    w_1.location
                   FROM public.workcenter w_1
                  WHERE ((t_1.workcentercode = (w_1.workcenternew)::text) OR (t_1.workcentercode = (w_1.workcenterold)::text) OR (t_1.workcentercode = (w_1.workcenterot)::text) OR (t_1.workcentercode = (w_1.machineid)::text))
                  ORDER BY
                        CASE
                            WHEN (t_1.workcentercode = (w_1.workcenternew)::text) THEN 1
                            WHEN (t_1.workcentercode = (w_1.machineid)::text) THEN 2
                            WHEN (t_1.workcentercode = (w_1.workcenterold)::text) THEN 3
                            WHEN (t_1.workcentercode = (w_1.workcenterot)::text) THEN 4
                            ELSE 5
                        END, w_1."position", w_1.idrow
                 LIMIT 1) w ON (true))
        )
 SELECT t.order_key,
    t.order_no,
    'running'::text AS current_source,
    COALESCE(NULLIF(t.location, ''::text), 'Unassigned'::text) AS current_location,
    t.lane_rank,
    t.machineid AS machine_id,
    t.machine_code,
    t.workcenter_description AS machine_description,
    t.operation_no,
    COALESCE(NULLIF(t.operation_text, ''::text), s.operation_text) AS operation_text,
    COALESCE(NULLIF(s.part_name, ''::text), NULLIF(t.part_name, ''::text)) AS part_name,
    COALESCE(NULLIF(s.ssbr_id, ''::text), NULLIF(t.ssbr_id, ''::text)) AS ssbr_id,
    'running'::text AS current_state,
    t.longdate_checkin AS state_entered_at,
    t.longdate_checkin AS last_movement_at,
    round((EXTRACT(epoch FROM (now() - t.longdate_checkin)) / 60.0), 2) AS state_age_minutes,
    round((EXTRACT(epoch FROM (now() - t.longdate_checkin)) / 60.0), 2) AS runtime_minutes,
    NULL::integer AS queue_priority,
    t.tsnumber AS evidence_tsnumber,
    NULL::bigint AS evidence_buffer_id,
    s.operation_no AS evidence_sow_operation_no,
    t.longdate_checkin AS event_ts
   FROM (timesheet_with_machine t
     LEFT JOIN LATERAL ( SELECT s_1.idsow,
            s_1.order_no,
            s_1.operation_no,
            s_1.ssbr_id,
            s_1.part_number,
            s_1.part_name,
            s_1.model,
            s_1.customer,
            s_1.location,
            s_1.wct_group,
            s_1.workcenter,
            s_1.operation_text,
            s_1.workcenterdescription,
            s_1.planhours,
            s_1.systemstatus,
            s_1.confirmation,
            s_1.status,
            s_1.finish_date,
            s_1.codenumber,
            s_1.weight,
            s_1.created_by,
            s_1.type,
            s_1."group",
            s_1.category,
            s_1.remark,
            s_1.sync,
            s_1.plan_start,
            s_1.plan_finish,
            s_1.actual_start,
            s_1.actual_finish,
            s_1.actual_progress,
            s_1.actual_hours,
            s_1.created_at,
            s_1.updated_at,
            s_1.progress,
            s_1.revision_no
           FROM public.sow s_1
          WHERE ((ltrim(COALESCE(s_1.order_no, ''::text), '0'::text) = t.order_key) AND ((t.operation_no IS NULL) OR (s_1.operation_no = t.operation_no)))
          ORDER BY s_1.idsow DESC
         LIMIT 1) s ON (true))
  WHERE ((t.order_key <> ''::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.v_kanban_teco_orders teco
          WHERE (teco.order_key = t.order_key)))));

CREATE VIEW public.v_kanban_next_sow_candidates AS
 WITH latest_sow AS (
         SELECT ranked.idsow,
            ranked.order_no,
            ranked.operation_no,
            ranked.ssbr_id,
            ranked.part_number,
            ranked.part_name,
            ranked.model,
            ranked.customer,
            ranked.location,
            ranked.wct_group,
            ranked.workcenter,
            ranked.operation_text,
            ranked.workcenterdescription,
            ranked.planhours,
            ranked.systemstatus,
            ranked.confirmation,
            ranked.status,
            ranked.finish_date,
            ranked.codenumber,
            ranked.weight,
            ranked.created_by,
            ranked.type,
            ranked."group",
            ranked.category,
            ranked.remark,
            ranked.sync,
            ranked.plan_start,
            ranked.plan_finish,
            ranked.actual_start,
            ranked.actual_finish,
            ranked.actual_progress,
            ranked.actual_hours,
            ranked.created_at,
            ranked.updated_at,
            ranked.progress,
            ranked.revision_no,
            ranked.order_key,
            ranked.rn
           FROM ( SELECT s_1.idsow,
                    s_1.order_no,
                    s_1.operation_no,
                    s_1.ssbr_id,
                    s_1.part_number,
                    s_1.part_name,
                    s_1.model,
                    s_1.customer,
                    s_1.location,
                    s_1.wct_group,
                    s_1.workcenter,
                    s_1.operation_text,
                    s_1.workcenterdescription,
                    s_1.planhours,
                    s_1.systemstatus,
                    s_1.confirmation,
                    s_1.status,
                    s_1.finish_date,
                    s_1.codenumber,
                    s_1.weight,
                    s_1.created_by,
                    s_1.type,
                    s_1."group",
                    s_1.category,
                    s_1.remark,
                    s_1.sync,
                    s_1.plan_start,
                    s_1.plan_finish,
                    s_1.actual_start,
                    s_1.actual_finish,
                    s_1.actual_progress,
                    s_1.actual_hours,
                    s_1.created_at,
                    s_1.updated_at,
                    s_1.progress,
                    s_1.revision_no,
                    ltrim(COALESCE(s_1.order_no, ''::text), '0'::text) AS order_key,
                    row_number() OVER (PARTITION BY (ltrim(COALESCE(s_1.order_no, ''::text), '0'::text)), s_1.operation_no ORDER BY s_1.idsow DESC) AS rn
                   FROM public.sow s_1
                  WHERE ((COALESCE(s_1.order_no, ''::text) <> ''::text) AND (s_1.operation_no IS NOT NULL))) ranked
          WHERE (ranked.rn = 1)
        ), open_sow AS (
         SELECT s_1.idsow,
            s_1.order_no,
            s_1.operation_no,
            s_1.ssbr_id,
            s_1.part_number,
            s_1.part_name,
            s_1.model,
            s_1.customer,
            s_1.location,
            s_1.wct_group,
            s_1.workcenter,
            s_1.operation_text,
            s_1.workcenterdescription,
            s_1.planhours,
            s_1.systemstatus,
            s_1.confirmation,
            s_1.status,
            s_1.finish_date,
            s_1.codenumber,
            s_1.weight,
            s_1.created_by,
            s_1.type,
            s_1."group",
            s_1.category,
            s_1.remark,
            s_1.sync,
            s_1.plan_start,
            s_1.plan_finish,
            s_1.actual_start,
            s_1.actual_finish,
            s_1.actual_progress,
            s_1.actual_hours,
            s_1.created_at,
            s_1.updated_at,
            s_1.progress,
            s_1.revision_no,
            s_1.order_key,
            s_1.rn,
                CASE
                    WHEN (lower(TRIM(BOTH FROM COALESCE(s_1.status, ''::text))) = ANY (ARRAY['finish'::text, 'finished'::text, 'complete'::text, 'completed'::text, 'done'::text])) THEN true
                    WHEN (s_1.actual_finish IS NOT NULL) THEN true
                    WHEN (COALESCE(s_1.progress, 0) >= 100) THEN true
                    WHEN (lower(TRIM(BOTH FROM COALESCE(s_1.systemstatus, ''::text))) ~~ '%finish%'::text) THEN true
                    ELSE false
                END AS is_finished
           FROM latest_sow s_1
        ), sow_candidates AS (
         SELECT s_1.idsow,
            s_1.order_no,
            s_1.operation_no,
            s_1.ssbr_id,
            s_1.part_number,
            s_1.part_name,
            s_1.model,
            s_1.customer,
            s_1.location,
            s_1.wct_group,
            s_1.workcenter,
            s_1.operation_text,
            s_1.workcenterdescription,
            s_1.planhours,
            s_1.systemstatus,
            s_1.confirmation,
            s_1.status,
            s_1.finish_date,
            s_1.codenumber,
            s_1.weight,
            s_1.created_by,
            s_1.type,
            s_1."group",
            s_1.category,
            s_1.remark,
            s_1.sync,
            s_1.plan_start,
            s_1.plan_finish,
            s_1.actual_start,
            s_1.actual_finish,
            s_1.actual_progress,
            s_1.actual_hours,
            s_1.created_at,
            s_1.updated_at,
            s_1.progress,
            s_1.revision_no,
            s_1.order_key,
            s_1.rn,
            s_1.is_finished,
            w.machineid,
            COALESCE(NULLIF((w.workcenternew)::text, ''::text), NULLIF((w.machineid)::text, ''::text), NULLIF((w.workcenterold)::text, ''::text), NULLIF((w.workcenterot)::text, ''::text)) AS machine_code,
            w.workcenter_description,
            w.location AS lane_location,
                CASE COALESCE(w.location, ''::text)
                    WHEN 'Incoming / Pre-Process'::text THEN 1
                    WHEN 'Cutting / Weld Repair'::text THEN 2
                    WHEN 'Rough Machining'::text THEN 3
                    WHEN 'Precision Machining'::text THEN 4
                    WHEN 'Surface Treatment / Coating'::text THEN 5
                    WHEN 'Inspection / Test'::text THEN 6
                    WHEN 'Packing / Ready Dispatch'::text THEN 7
                    WHEN 'Support'::text THEN 8
                    ELSE 0
                END AS lane_rank
           FROM (open_sow s_1
             LEFT JOIN LATERAL ( SELECT w_1.idrow,
                    w_1.plant,
                    w_1.workcenterot,
                    w_1.condition,
                    w_1.categoryhours,
                    w_1.groupname,
                    w_1.machineid,
                    w_1."position",
                    w_1.costcenter,
                    w_1.costcenter_rate,
                    w_1.workcenter_description,
                    w_1.workcenternew,
                    w_1.workcenterold,
                    w_1.location
                   FROM public.workcenter w_1
                  WHERE ((s_1.workcenter = (w_1.workcenternew)::text) OR (s_1.workcenter = (w_1.workcenterold)::text) OR (s_1.workcenter = (w_1.workcenterot)::text) OR (s_1.workcenter = (w_1.machineid)::text))
                  ORDER BY
                        CASE
                            WHEN (s_1.workcenter = (w_1.workcenternew)::text) THEN 1
                            WHEN (s_1.workcenter = (w_1.machineid)::text) THEN 2
                            WHEN (s_1.workcenter = (w_1.workcenterold)::text) THEN 3
                            WHEN (s_1.workcenter = (w_1.workcenterot)::text) THEN 4
                            ELSE 5
                        END, w_1."position", w_1.idrow
                 LIMIT 1) w ON (true))
          WHERE ((NOT s_1.is_finished) AND (s_1.order_key <> ''::text) AND (NOT (EXISTS ( SELECT 1
                   FROM public.v_kanban_teco_orders teco
                  WHERE (teco.order_key = s_1.order_key)))) AND (NOT (EXISTS ( SELECT 1
                   FROM public.v_kanban_running_candidates rc
                  WHERE (rc.order_key = s_1.order_key)))) AND (NOT (EXISTS ( SELECT 1
                   FROM public.v_kanban_queue_candidates qc
                  WHERE (qc.order_key = s_1.order_key)))))
        )
 SELECT s.order_key,
    s.order_no,
    'sow'::text AS current_source,
    COALESCE(NULLIF(s.lane_location, ''::text), 'Unassigned'::text) AS current_location,
    s.lane_rank,
    s.machineid AS machine_id,
    s.machine_code,
    s.workcenter_description AS machine_description,
    s.operation_no,
    s.operation_text,
    s.part_name,
    s.ssbr_id,
    'planned'::text AS current_state,
    history.last_known_movement_at AS state_entered_at,
    history.last_known_movement_at AS last_movement_at,
        CASE
            WHEN (history.last_known_movement_at IS NULL) THEN NULL::numeric
            ELSE round((EXTRACT(epoch FROM (now() - history.last_known_movement_at)) / 60.0), 2)
        END AS state_age_minutes,
    NULL::numeric AS runtime_minutes,
    NULL::integer AS queue_priority,
    history.evidence_tsnumber,
    history.evidence_buffer_id,
    s.operation_no AS evidence_sow_operation_no,
    COALESCE(history.last_known_movement_at, (now() - '100 years'::interval)) AS event_ts
   FROM (sow_candidates s
     LEFT JOIN LATERAL ( SELECT max(h.movement_at) AS last_known_movement_at,
            max(h.tsnumber) FILTER (WHERE (h.src = 'timesheet'::text)) AS evidence_tsnumber,
            max(h.buffer_id) FILTER (WHERE (h.src = 'buffer'::text)) AS evidence_buffer_id
           FROM ( SELECT t.longdate_checkin AS movement_at,
                    t.tsnumber,
                    NULL::bigint AS buffer_id,
                    'timesheet'::text AS src
                   FROM public.timesheet_transaction t
                  WHERE ((ltrim(COALESCE(t.order_no, ''::text), '0'::text) = s.order_key) AND (t.longdate_checkin IS NOT NULL))
                UNION ALL
                 SELECT t.longdate_checkout AS movement_at,
                    t.tsnumber,
                    NULL::bigint AS buffer_id,
                    'timesheet'::text AS src
                   FROM public.timesheet_transaction t
                  WHERE ((ltrim(COALESCE(t.order_no, ''::text), '0'::text) = s.order_key) AND (t.longdate_checkout IS NOT NULL))
                UNION ALL
                 SELECT b."timestamp" AS movement_at,
                    NULL::integer AS tsnumber,
                    b.id AS buffer_id,
                    'buffer'::text AS src
                   FROM public.buffer_transaction b
                  WHERE (ltrim(COALESCE(b.order_no, ''::text), '0'::text) = s.order_key)) h) history ON (true));

CREATE VIEW public.v_kanban_order_candidates AS
 SELECT v_kanban_running_candidates.order_key,
    v_kanban_running_candidates.order_no,
    v_kanban_running_candidates.current_source,
    v_kanban_running_candidates.current_location,
    v_kanban_running_candidates.lane_rank,
    v_kanban_running_candidates.machine_id,
    v_kanban_running_candidates.machine_code,
    v_kanban_running_candidates.machine_description,
    v_kanban_running_candidates.operation_no,
    v_kanban_running_candidates.operation_text,
    v_kanban_running_candidates.part_name,
    v_kanban_running_candidates.ssbr_id,
    v_kanban_running_candidates.current_state,
    v_kanban_running_candidates.state_entered_at,
    v_kanban_running_candidates.last_movement_at,
    v_kanban_running_candidates.state_age_minutes,
    v_kanban_running_candidates.runtime_minutes,
    v_kanban_running_candidates.queue_priority,
    v_kanban_running_candidates.evidence_tsnumber,
    v_kanban_running_candidates.evidence_buffer_id,
    v_kanban_running_candidates.evidence_sow_operation_no,
    v_kanban_running_candidates.event_ts
   FROM public.v_kanban_running_candidates
UNION ALL
 SELECT v_kanban_queue_candidates.order_key,
    v_kanban_queue_candidates.order_no,
    v_kanban_queue_candidates.current_source,
    v_kanban_queue_candidates.current_location,
    v_kanban_queue_candidates.lane_rank,
    v_kanban_queue_candidates.machine_id,
    v_kanban_queue_candidates.machine_code,
    v_kanban_queue_candidates.machine_description,
    v_kanban_queue_candidates.operation_no,
    v_kanban_queue_candidates.operation_text,
    v_kanban_queue_candidates.part_name,
    v_kanban_queue_candidates.ssbr_id,
    v_kanban_queue_candidates.current_state,
    v_kanban_queue_candidates.state_entered_at,
    v_kanban_queue_candidates.last_movement_at,
    v_kanban_queue_candidates.state_age_minutes,
    v_kanban_queue_candidates.runtime_minutes,
    v_kanban_queue_candidates.queue_priority,
    v_kanban_queue_candidates.evidence_tsnumber,
    v_kanban_queue_candidates.evidence_buffer_id,
    v_kanban_queue_candidates.evidence_sow_operation_no,
    v_kanban_queue_candidates.event_ts
   FROM public.v_kanban_queue_candidates
UNION ALL
 SELECT v_kanban_next_sow_candidates.order_key,
    v_kanban_next_sow_candidates.order_no,
    v_kanban_next_sow_candidates.current_source,
    v_kanban_next_sow_candidates.current_location,
    v_kanban_next_sow_candidates.lane_rank,
    v_kanban_next_sow_candidates.machine_id,
    v_kanban_next_sow_candidates.machine_code,
    v_kanban_next_sow_candidates.machine_description,
    v_kanban_next_sow_candidates.operation_no,
    v_kanban_next_sow_candidates.operation_text,
    v_kanban_next_sow_candidates.part_name,
    v_kanban_next_sow_candidates.ssbr_id,
    v_kanban_next_sow_candidates.current_state,
    v_kanban_next_sow_candidates.state_entered_at,
    v_kanban_next_sow_candidates.last_movement_at,
    v_kanban_next_sow_candidates.state_age_minutes,
    v_kanban_next_sow_candidates.runtime_minutes,
    v_kanban_next_sow_candidates.queue_priority,
    v_kanban_next_sow_candidates.evidence_tsnumber,
    v_kanban_next_sow_candidates.evidence_buffer_id,
    v_kanban_next_sow_candidates.evidence_sow_operation_no,
    v_kanban_next_sow_candidates.event_ts
   FROM public.v_kanban_next_sow_candidates;

CREATE VIEW public.v_kanban_order_resolved AS
 WITH ranked AS (
         SELECT c.order_key,
            c.order_no,
            c.current_source,
            c.current_location,
            c.lane_rank,
            c.machine_id,
            c.machine_code,
            c.machine_description,
            c.operation_no,
            c.operation_text,
            c.part_name,
            c.ssbr_id,
            c.current_state,
            c.state_entered_at,
            c.last_movement_at,
            c.state_age_minutes,
            c.runtime_minutes,
            c.queue_priority,
            c.evidence_tsnumber,
            c.evidence_buffer_id,
            c.evidence_sow_operation_no,
            c.event_ts,
                CASE c.current_source
                    WHEN 'running'::text THEN 1
                    WHEN 'queue'::text THEN 2
                    ELSE 3
                END AS source_precedence,
            row_number() OVER (PARTITION BY c.order_key ORDER BY
                CASE c.current_source
                    WHEN 'running'::text THEN 1
                    WHEN 'queue'::text THEN 2
                    ELSE 3
                END, c.lane_rank DESC, c.event_ts DESC NULLS LAST, c.queue_priority DESC NULLS LAST, c.operation_no DESC NULLS LAST, c.order_no DESC) AS winner_rank
           FROM public.v_kanban_order_candidates c
        ), parallel_stats AS (
         SELECT v_kanban_order_candidates.order_key,
            v_kanban_order_candidates.current_source,
            (GREATEST((count(*) - 1), (0)::bigint))::integer AS parallel_count,
            string_agg(DISTINCT v_kanban_order_candidates.current_location, ', '::text ORDER BY v_kanban_order_candidates.current_location) AS parallel_locations
           FROM public.v_kanban_order_candidates
          GROUP BY v_kanban_order_candidates.order_key, v_kanban_order_candidates.current_source
        ), source_flags AS (
         SELECT v_kanban_order_candidates.order_key,
            (count(*) FILTER (WHERE (v_kanban_order_candidates.current_source = 'running'::text)) > 1) AS has_running_parallel,
            (count(*) FILTER (WHERE (v_kanban_order_candidates.current_source = 'queue'::text)) > 1) AS has_queue_parallel
           FROM public.v_kanban_order_candidates
          GROUP BY v_kanban_order_candidates.order_key
        )
 SELECT r.order_key,
    r.order_no AS order_no_display,
    r.current_source,
    r.current_location,
    r.lane_rank,
    r.machine_id,
    r.machine_code,
    r.machine_description,
    r.operation_no,
    r.operation_text,
    r.part_name,
    r.ssbr_id,
    r.current_state,
    r.state_entered_at,
    r.last_movement_at,
    r.state_age_minutes,
        CASE
            WHEN (r.state_age_minutes IS NULL) THEN 'unknown'::text
            WHEN ((r.current_source = 'running'::text) AND (r.state_age_minutes < (240)::numeric)) THEN 'green'::text
            WHEN ((r.current_source = 'running'::text) AND (r.state_age_minutes < (480)::numeric)) THEN 'amber'::text
            WHEN (r.current_source = 'running'::text) THEN 'red'::text
            WHEN ((r.current_source = 'queue'::text) AND (r.state_age_minutes < (480)::numeric)) THEN 'green'::text
            WHEN ((r.current_source = 'queue'::text) AND (r.state_age_minutes < (1440)::numeric)) THEN 'amber'::text
            WHEN (r.current_source = 'queue'::text) THEN 'red'::text
            WHEN (r.state_age_minutes < (1440)::numeric) THEN 'green'::text
            WHEN (r.state_age_minutes < (4320)::numeric) THEN 'amber'::text
            ELSE 'red'::text
        END AS aging_band,
    r.runtime_minutes,
    COALESCE(ps.parallel_count, 0) AS parallel_count,
    COALESCE(ps.parallel_locations, r.current_location) AS parallel_locations,
    COALESCE(sf.has_running_parallel, false) AS has_running_parallel,
    COALESCE(sf.has_queue_parallel, false) AS has_queue_parallel,
    r.queue_priority,
    r.evidence_tsnumber,
    r.evidence_buffer_id,
    r.evidence_sow_operation_no
   FROM ((ranked r
     LEFT JOIN parallel_stats ps ON (((ps.order_key = r.order_key) AND (ps.current_source = r.current_source))))
     LEFT JOIN source_flags sf ON ((sf.order_key = r.order_key)))
  WHERE (r.winner_rank = 1);

CREATE MATERIALIZED VIEW public.mv_kanban_order_board AS
 SELECT r.order_key,
    r.order_no_display,
    r.current_source,
    r.current_location,
    r.lane_rank,
    r.machine_id,
    r.machine_code,
    r.machine_description,
    r.operation_no,
    r.operation_text,
    r.part_name,
    r.ssbr_id,
    r.current_state,
    r.state_entered_at,
    r.last_movement_at,
    r.state_age_minutes,
    r.aging_band,
    r.runtime_minutes,
    r.parallel_count,
    r.parallel_locations,
    r.has_running_parallel,
    r.has_queue_parallel,
    r.queue_priority,
    r.evidence_tsnumber,
    r.evidence_buffer_id,
    r.evidence_sow_operation_no,
    now() AS refreshed_at
   FROM public.v_kanban_order_resolved r
  WITH NO DATA;

CREATE MATERIALIZED VIEW public.mv_mch_productiondata_detail AS
 SELECT p.proddataid,
    p.startdatetime,
    p.enddatetime,
    (p.startdatetime)::date AS work_date,
    to_char(p.startdatetime, 'HH24:MI:SS'::text) AS start_time,
    to_char(p.enddatetime, 'HH24:MI:SS'::text) AS end_time,
    p.duration AS source_duration,
        CASE
            WHEN (p.enddatetime IS NULL) THEN (0)::bigint
            ELSE (GREATEST(EXTRACT(epoch FROM (p.enddatetime - p.startdatetime)), (0)::numeric))::bigint
        END AS duration_seconds,
    round(
        CASE
            WHEN (p.enddatetime IS NULL) THEN (0)::numeric
            ELSE (GREATEST(EXTRACT(epoch FROM (p.enddatetime - p.startdatetime)), (0)::numeric) / 3600.0)
        END, 4) AS duration_hours,
    p.machineno,
    m.sitemachineno,
    m.machinegroupid,
    m.plantid AS machine_plantid,
    m.machinetypeid,
    COALESCE(m.machineid, ''::character varying) AS machineid,
    COALESCE(m.machinename, ''::character varying) AS machinename,
    p.statusid,
    p.previoustatusid,
    COALESCE(st.description, 'Unknown'::character varying) AS status_description,
    COALESCE(st.activitytype, ''::character varying) AS status_activitytype,
    pst.description AS previous_status_description,
    ph3.confirmation_number,
    ph3.order_no,
    ph3.operation_no,
    ph3.operation_short_text,
    ph3.operation_description,
    ph3.sequence_category,
    ph3.sequence_number,
    ph3.branch_operation_no,
    ph3.return_operation_no,
    ph3.cost_center,
    ph3.material_no,
    ph3.material_description,
    ts.ssbr_id,
    ts.full_name,
    ts.serialnumber AS sn_employee,
    ts.workcentercode,
    ts.tsnumber,
    ts.longdate_checkin AS checkin,
    now() AS refreshed_at
   FROM (((((public.mch_productiondata p
     LEFT JOIN public.mch_machines m ON ((m.machineno = p.machineno)))
     LEFT JOIN public.mch_statustypes st ON ((st.statusid = p.statusid)))
     LEFT JOIN public.mch_statustypes pst ON ((pst.statusid = p.previoustatusid)))
     LEFT JOIN LATERAL ( SELECT ph3_1.id,
            ph3_1.confirmation_number,
            ph3_1.indicator_code,
            ph3_1.operation_short_text,
            ph3_1.order_no,
            ph3_1.operation_no,
            ph3_1.sequence_category,
            ph3_1.sequence_number,
            ph3_1.branch_operation_no,
            ph3_1.return_operation_no,
            ph3_1.material_no,
            ph3_1.material_description,
            ph3_1.operation_description,
            ph3_1.work_center,
            ph3_1.cost_center,
            ph3_1.plant_code,
            ph3_1.unit_of_measure,
            ph3_1.standard_value,
            ph3_1.order_type,
            ph3_1.order_description,
            ph3_1.created_at,
            ph3_1.status_etl
           FROM public.ph3_order ph3_1
          WHERE ((ph3_1.confirmation_number)::text = (COALESCE(p.jobid, ''::character varying))::text)
          ORDER BY ph3_1.id DESC
         LIMIT 1) ph3 ON (true))
     LEFT JOIN LATERAL ( SELECT t.tsnumber,
            t.activitytype,
            t.operation_text,
            t.confirmationnumber,
            t.ssbr_id,
            t.date_checkin,
            t.date_checkout,
            t.full_name,
            t.hour_checkin,
            t.hour_checkout,
            t.longdate_checkin,
            t.longdate_checkout,
            t.note,
            t.part_name,
            t.planhours,
            t.plant,
            t.serialnumber,
            t.state_flag,
            t.std_foreman_hours,
            t.validation_date,
            t.workcentercode,
            t.workcenterdescription,
            t.duration,
            t.operation_no,
            t.order_no,
            t.modified_at,
            (abs(EXTRACT(epoch FROM ((t.longdate_checkin AT TIME ZONE 'Asia/Makassar'::text) - p.startdatetime))))::bigint AS time_diff_seconds
           FROM public.timesheet_transaction t
          WHERE ((t.order_no = (ph3.order_no)::text) AND (t.operation_no =
                CASE
                    WHEN ((ph3.operation_no)::text ~ '^[0-9]+$'::text) THEN (ph3.operation_no)::integer
                    ELSE NULL::integer
                END) AND (t.longdate_checkin IS NOT NULL) AND (t.longdate_checkin >= ((p.startdatetime - '1 day'::interval) AT TIME ZONE 'Asia/Makassar'::text)) AND (t.longdate_checkin < ((p.startdatetime + '1 day'::interval) AT TIME ZONE 'Asia/Makassar'::text)))
          ORDER BY (abs(EXTRACT(epoch FROM ((t.longdate_checkin AT TIME ZONE 'Asia/Makassar'::text) - p.startdatetime)))), t.tsnumber DESC
         LIMIT 1) ts ON (true))
  WITH NO DATA;

CREATE MATERIALIZED VIEW public.mv_order_activity_detail AS
 WITH sow_ops AS (
         SELECT sow.order_no,
            sow.operation_no,
            sow.operation_text,
            sow.workcenter,
            sow.planhours,
            sow.weight,
            sow.progress
           FROM public.sow
          WHERE ((COALESCE(sow.systemstatus, ''::text) <> ALL (ARRAY['TECO'::text, 'CLSD'::text])) AND (sow.planhours IS NOT NULL))
        ), ts_ops AS (
         SELECT timesheet_transaction.order_no,
            timesheet_transaction.operation_no,
            sum(timesheet_transaction.duration) AS actual_hours
           FROM public.timesheet_transaction
          WHERE ((timesheet_transaction.state_flag <> 5) AND (timesheet_transaction.duration IS NOT NULL) AND (timesheet_transaction.order_no IS NOT NULL) AND (timesheet_transaction.operation_no IS NOT NULL))
          GROUP BY timesheet_transaction.order_no, timesheet_transaction.operation_no
        )
 SELECT COALESCE(s.order_no, t.order_no) AS order_no,
    COALESCE(s.operation_no, t.operation_no) AS operation_no,
    s.operation_text,
    s.workcenter,
    COALESCE(s.planhours, (0)::numeric) AS planhours,
    s.weight,
    s.progress,
    COALESCE(t.actual_hours, (0)::numeric) AS actual_hours
   FROM (sow_ops s
     FULL JOIN ts_ops t ON (((t.order_no = s.order_no) AND (t.operation_no = s.operation_no))))
  WHERE ((COALESCE(s.planhours, (0)::numeric) > (0)::numeric) OR (COALESCE(t.actual_hours, (0)::numeric) > (0)::numeric))
  ORDER BY COALESCE(s.order_no, t.order_no), COALESCE(s.operation_no, t.operation_no)
  WITH NO DATA;

CREATE MATERIALIZED VIEW public.mv_order_plan_vs_actual AS
 WITH plan AS (
         SELECT sow.order_no,
            min(sow.customer) AS customer,
            min(sow.part_name) AS part_name,
            min(sow.model) AS model,
            min(sow.ssbr_id) AS ssbr_id,
            sum(sow.planhours) AS total_planhours,
            count(*) AS operation_count,
            round(sum((COALESCE(sow.weight, (0)::numeric) * (100)::numeric)) FILTER (WHERE (sow.progress = 1)), 1) AS weighted_progress
           FROM public.sow
          WHERE ((COALESCE(sow.systemstatus, ''::text) <> ALL (ARRAY['TECO'::text, 'CLSD'::text])) AND (sow.planhours IS NOT NULL))
          GROUP BY sow.order_no
        ), actual AS (
         SELECT timesheet_transaction.order_no,
            sum(timesheet_transaction.duration) AS total_actual_hours,
            count(DISTINCT timesheet_transaction.full_name) AS operator_count
           FROM public.timesheet_transaction
          WHERE ((timesheet_transaction.state_flag <> 5) AND (timesheet_transaction.duration IS NOT NULL))
          GROUP BY timesheet_transaction.order_no
        )
 SELECT p.order_no,
    p.customer,
    p.part_name,
    p.model,
    p.ssbr_id,
    p.total_planhours,
    p.operation_count,
    p.weighted_progress,
    COALESCE(a.total_actual_hours, (0)::numeric) AS total_actual_hours,
    round(((COALESCE(a.total_actual_hours, (0)::numeric) / NULLIF(p.total_planhours, (0)::numeric)) * (100)::numeric), 1) AS actual_pct,
        CASE
            WHEN (COALESCE(a.total_actual_hours, (0)::numeric) >= p.total_planhours) THEN true
            ELSE false
        END AS is_exceeded
   FROM (plan p
     LEFT JOIN actual a ON ((a.order_no = p.order_no)))
  ORDER BY p.total_planhours DESC
  WITH NO DATA;

CREATE MATERIALIZED VIEW public.mv_order_remaining_hours AS
 WITH valid_orders AS (
         SELECT DISTINCT sow.order_no
           FROM public.sow
        EXCEPT
         SELECT ltrim((ph3_order.order_no)::text, '0'::text) AS ltrim
           FROM public.ph3_order
          WHERE (ph3_order.order_description ~~* '%TECO%'::text)
        ), plan_hours AS (
         SELECT sow.order_no,
            min(sow.ssbr_id) AS ssbr_id,
            min(sow.part_name) AS part_name,
            COALESCE(sum(sow.planhours), (0)::numeric) AS total_planhours
           FROM public.sow
          WHERE (sow.planhours IS NOT NULL)
          GROUP BY sow.order_no
        ), actual_hours AS (
         SELECT timesheet_transaction.order_no,
            COALESCE(sum(timesheet_transaction.duration), (0)::numeric) AS total_actual_hours
           FROM public.timesheet_transaction
          WHERE ((timesheet_transaction.state_flag <> 5) AND (timesheet_transaction.duration IS NOT NULL))
          GROUP BY timesheet_transaction.order_no
        )
 SELECT v.order_no,
    p.ssbr_id,
    p.part_name,
    p.total_planhours,
    a.total_actual_hours,
    (p.total_planhours - a.total_actual_hours) AS remaining_hours,
    ((p.total_planhours - a.total_actual_hours) <= (0)::numeric) AS is_exceeded
   FROM ((valid_orders v
     LEFT JOIN plan_hours p ON ((p.order_no = v.order_no)))
     LEFT JOIN actual_hours a ON ((a.order_no = v.order_no)))
  WHERE (p.total_planhours > (0)::numeric)
  WITH NO DATA;

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

ALTER TABLE public.ph3_order ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ph3_order_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.plant_config (
    id integer DEFAULT 1 NOT NULL,
    plant_code text NOT NULL,
    plant_name text NOT NULL,
    variant text NOT NULL,
    timezone text NOT NULL,
    order_master_table text DEFAULT 'ph3_order'::text NOT NULL,
    plant_filter text,
    feature_flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    sap_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plant_config_id_check CHECK ((id = 1)),
    CONSTRAINT plant_config_variant_check CHECK ((variant = ANY (ARRAY['salvaging'::text, 'manufacturing'::text])))
);

COMMENT ON TABLE public.plant_config IS 'Single-row per-plant config: identitas plant + varian + timezone. Diisi via apps/api/scripts/seed_plant_config.js. Lihat docs/deployment/PLANT_CONFIG_VARIANT_DESIGN.md';

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

CREATE TABLE public.sap_ops_request (
    id bigint NOT NULL,
    action text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    requested_by text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    result text,
    error text,
    CONSTRAINT sap_ops_request_action_ck CHECK ((action = ANY (ARRAY['stage_catchup'::text, 'retry_failed'::text, 'post_corrections'::text]))),
    CONSTRAINT sap_ops_request_status_ck CHECK ((status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text, 'DONE'::text, 'ERROR'::text])))
);

ALTER TABLE public.sap_ops_request ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sap_ops_request_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sap_source_change_blocked (
    id bigint NOT NULL,
    source_system text NOT NULL,
    source_row_id text NOT NULL,
    blocked_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_field text NOT NULL,
    old_value text,
    new_value text,
    staging_ids bigint[]
);

ALTER TABLE public.sap_source_change_blocked ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sap_source_change_blocked_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sap_stage_cursor (
    source_system text NOT NULL,
    plant text NOT NULL,
    last_processed_at timestamp without time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sap_staging_eligibility_audit (
    source_system text NOT NULL,
    source_key text NOT NULL,
    source_ref_id text,
    source_date date,
    plant text DEFAULT ''::text NOT NULL,
    eligibility_status text NOT NULL,
    block_reason text,
    block_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sap_staging_source (
    id bigint NOT NULL,
    staging_id bigint NOT NULL,
    source_system text NOT NULL,
    source_row_id text NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    seconds bigint DEFAULT 0 NOT NULL,
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.sap_staging_source ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sap_staging_source_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sap_timesheet_staging (
    id bigint NOT NULL,
    ztimesheetid text GENERATED ALWAYS AS ((id)::text) STORED,
    source_system text NOT NULL,
    source_key text NOT NULL,
    source_ref_id text,
    werks text DEFAULT ''::text NOT NULL,
    pernr text DEFAULT ''::text NOT NULL,
    rueck text DEFAULT ''::text NOT NULL,
    aufnr text DEFAULT ''::text NOT NULL,
    vornr text DEFAULT ''::text NOT NULL,
    flgat text DEFAULT ''::text NOT NULL,
    plnfl text DEFAULT ''::text NOT NULL,
    vornr_b text DEFAULT ''::text NOT NULL,
    vornr_r text DEFAULT ''::text NOT NULL,
    zconf_type text DEFAULT ''::text NOT NULL,
    arbpl text DEFAULT ''::text NOT NULL,
    lstar text DEFAULT ''::text NOT NULL,
    isdd text DEFAULT ''::text NOT NULL,
    isdz text DEFAULT ''::text NOT NULL,
    iedd text DEFAULT ''::text NOT NULL,
    iedz text DEFAULT ''::text NOT NULL,
    aueru text DEFAULT ''::text NOT NULL,
    zbarcodeid text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    bucket_start timestamp without time zone,
    synthetic_start timestamp without time zone,
    synthetic_end timestamp without time zone,
    total_seconds bigint,
    source_row_count integer DEFAULT 1 NOT NULL,
    source_min_start timestamp without time zone,
    source_max_end timestamp without time zone,
    status text DEFAULT 'PENDING'::text NOT NULL,
    sap_response jsonb,
    sap_response_text text,
    sap_error text,
    posted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pernr_origin text DEFAULT ''::text NOT NULL,
    is_productive boolean GENERATED ALWAYS AS ((zconf_type = ANY (ARRAY['M1'::text, 'M2'::text]))) STORED,
    is_correction boolean DEFAULT false NOT NULL,
    CONSTRAINT sap_timesheet_staging_source_system_ck CHECK ((source_system = ANY (ARRAY['TIMESHEET'::text, 'MCH_HOURS'::text]))),
    CONSTRAINT sap_timesheet_staging_status_ck CHECK ((status = ANY (ARRAY['PENDING'::text, 'POSTING'::text, 'POSTED'::text, 'FAILED'::text, 'SKIPPED'::text])))
);

ALTER TABLE public.sap_timesheet_staging ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sap_timesheet_staging_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    note text
);

CREATE TABLE public.shift_definition (
    id bigint NOT NULL,
    shift_code text NOT NULL,
    shift_name text NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    crosses_midnight boolean DEFAULT false NOT NULL,
    default_capacity_hours numeric(10,2) DEFAULT 8 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    effective_date date,
    is_default boolean DEFAULT true NOT NULL
);

ALTER TABLE public.shift_definition ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.shift_definition_id_seq
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

CREATE TABLE public.sow_documentno (
    id bigint NOT NULL,
    documentno text NOT NULL,
    "default" boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date date,
    revision_no character varying
);

ALTER TABLE public.sow_documentno ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_documentno_id_seq
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

CREATE TABLE public.sow_machine_capacity (
    id bigint NOT NULL,
    machine_code text NOT NULL,
    machine_name text,
    workcenter text,
    schedule_date date NOT NULL,
    shift_id bigint NOT NULL,
    capacity_type text DEFAULT 'STANDARD'::text NOT NULL,
    base_capacity_hours numeric(10,2) DEFAULT 0 NOT NULL,
    manpower_count numeric(10,2) DEFAULT 1 NOT NULL,
    capacity_multiplier numeric(10,2) DEFAULT 1 NOT NULL,
    total_capacity_hours numeric(10,2) DEFAULT 0 NOT NULL,
    remarks text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sow_machine_capacity_capacity_type_check CHECK ((capacity_type = ANY (ARRAY['STANDARD'::text, 'MANPOWER_BASED'::text, 'BATCH_BASED'::text, 'CUSTOM'::text])))
);

ALTER TABLE public.sow_machine_capacity ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_machine_capacity_id_seq
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

CREATE TABLE public.sow_operation_status (
    id bigint NOT NULL,
    production_order text NOT NULL,
    operation_no integer NOT NULL,
    machine_code text NOT NULL,
    manual_flag text NOT NULL,
    blocked_reason text,
    blocked_by_machine_code text,
    blocked_by_order text,
    override_note text,
    status_date date DEFAULT CURRENT_DATE NOT NULL,
    updated_by integer,
    updated_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sow_operation_status_blocked_reason_chk CHECK (((manual_flag <> 'nyangkut'::text) OR (blocked_reason IS NOT NULL))),
    CONSTRAINT sow_operation_status_manual_flag_check CHECK ((manual_flag = ANY (ARRAY['dilewati'::text, 'nyangkut'::text])))
);

CREATE SEQUENCE public.sow_operation_status_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sow_operation_status_id_seq OWNED BY public.sow_operation_status.id;

CREATE TABLE public.sow_operationcard (
    id integer NOT NULL,
    sow_standard_id integer NOT NULL,
    card_key character varying(255),
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    ref_id integer,
    ref_type character varying(20) DEFAULT 'standard'::character varying,
    order_no text,
    operation_no integer,
    revision_no text DEFAULT 'Original'::text NOT NULL,
    image_path text
);

ALTER TABLE public.sow_operationcard ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_operationcard_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sow_overtime_request (
    id bigint NOT NULL,
    sow_id integer,
    production_order text,
    operation_no integer,
    sequence integer,
    ssbr_id text,
    workcenter text,
    machine_code text NOT NULL,
    overtime_date date NOT NULL,
    shift_id bigint,
    overtime_start_datetime timestamp with time zone NOT NULL,
    overtime_end_datetime timestamp with time zone NOT NULL,
    overtime_hours numeric(10,2) NOT NULL,
    note text,
    request_status text DEFAULT 'PENDING'::text NOT NULL,
    requested_by_user_id integer,
    requested_by_name text,
    approved_by_user_id integer,
    approved_by_name text,
    approved_at timestamp with time zone,
    rejected_by_user_id integer,
    rejected_by_name text,
    rejected_at timestamp with time zone,
    rejection_note text,
    warning_flag boolean DEFAULT false NOT NULL,
    warning_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_to text,
    assigned_by text,
    assigned_to_name text,
    CONSTRAINT sow_overtime_request_check CHECK ((overtime_end_datetime > overtime_start_datetime)),
    CONSTRAINT sow_overtime_request_overtime_hours_check CHECK ((overtime_hours > (0)::numeric)),
    CONSTRAINT sow_overtime_request_request_status_check CHECK ((request_status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
);

ALTER TABLE public.sow_overtime_request ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_overtime_request_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

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

CREATE TABLE public.sow_schedule (
    id bigint NOT NULL,
    sow_id integer,
    production_order text,
    operation_no integer,
    sequence integer,
    ssbr_id text,
    workcenter text,
    machine_code text,
    schedule_date date NOT NULL,
    shift_id bigint,
    planned_start_datetime timestamp with time zone,
    planned_end_datetime timestamp with time zone,
    planned_hours numeric(10,2) DEFAULT 0 NOT NULL,
    planned_queue_no integer,
    priority_no integer,
    schedule_status text DEFAULT 'PLANNED'::text NOT NULL,
    schedule_source_type text DEFAULT 'SOW'::text NOT NULL,
    batch_id bigint,
    is_overtime boolean DEFAULT false NOT NULL,
    overtime_request_id bigint,
    warning_flag boolean DEFAULT false NOT NULL,
    warning_message text,
    remarks text,
    created_by_user_id integer,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sow_schedule_check CHECK (((planned_start_datetime IS NULL) OR (planned_end_datetime IS NULL) OR (planned_end_datetime > planned_start_datetime))),
    CONSTRAINT sow_schedule_planned_hours_check CHECK ((planned_hours >= (0)::numeric)),
    CONSTRAINT sow_schedule_schedule_source_type_check CHECK ((schedule_source_type = ANY (ARRAY['SOW'::text, 'MANUAL'::text]))),
    CONSTRAINT sow_schedule_schedule_status_check CHECK ((schedule_status = ANY (ARRAY['PLANNED'::text, 'UNPLANNED'::text, 'PARTIAL'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);

CREATE TABLE public.sow_schedule_batch (
    id bigint NOT NULL,
    batch_code text NOT NULL,
    machine_code text NOT NULL,
    workcenter text,
    schedule_date date NOT NULL,
    shift_id bigint,
    batch_start_datetime timestamp with time zone,
    batch_end_datetime timestamp with time zone,
    batch_capacity_hours numeric(10,2) DEFAULT 0 NOT NULL,
    batch_status text DEFAULT 'OPEN'::text NOT NULL,
    remarks text,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sow_schedule_batch_batch_status_check CHECK ((batch_status = ANY (ARRAY['OPEN'::text, 'PLANNED'::text, 'RUNNING'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);

ALTER TABLE public.sow_schedule_batch ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_schedule_batch_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE public.sow_schedule ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_schedule_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sow_standard (
    id bigint NOT NULL,
    component_id bigint NOT NULL,
    operation_no integer NOT NULL,
    operation_text text NOT NULL,
    machineid text,
    workcenter text,
    std_hours numeric(10,2),
    source_plant integer,
    remark text
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

CREATE TABLE public.sow_sub_operation (
    id bigint NOT NULL,
    operation_id integer NOT NULL,
    order_no character varying(100),
    title text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    weight numeric(6,2) DEFAULT 1 NOT NULL,
    progress smallint DEFAULT 0 NOT NULL,
    status text DEFAULT 'NOT_STARTED'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    msp_task_id uuid,
    created_by character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    updated_by character varying(100),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sow_sub_operation_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT sow_sub_operation_status_check CHECK ((status = ANY (ARRAY['NOT_STARTED'::text, 'IN_PROGRESS'::text, 'ON_HOLD'::text, 'DONE'::text])))
);

COMMENT ON TABLE public.sow_sub_operation IS 'Child-task progress fisik per operasi SOW (varian manufaktur). Roll-up ke sow.progress controller-side; tidak pernah ke SAP.';

COMMENT ON COLUMN public.sow_sub_operation.operation_id IS 'FK ke sow.idsow (1 operasi SAP). ON DELETE CASCADE.';

COMMENT ON COLUMN public.sow_sub_operation.weight IS 'Bobot untuk weighted roll-up SUM(progress*weight)/SUM(weight) atas child aktif.';

COMMENT ON COLUMN public.sow_sub_operation.is_active IS 'Soft-delete: false = dikeluarkan dari roll-up (bukan hapus baris).';

COMMENT ON COLUMN public.sow_sub_operation.msp_task_id IS 'Opsional: tautan ke ms_project_task; child tetap web-authoritative.';

CREATE SEQUENCE public.sow_sub_operation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sow_sub_operation_id_seq OWNED BY public.sow_sub_operation.id;

CREATE TABLE public.sow_sub_operation_progress_history (
    id bigint NOT NULL,
    sub_operation_id bigint NOT NULL,
    operation_id integer,
    order_no character varying(100),
    progress smallint NOT NULL,
    issue_description text,
    image_path character varying(500),
    created_at timestamp with time zone DEFAULT now(),
    created_by character varying(100),
    CONSTRAINT sow_sub_operation_progress_history_progress_check CHECK (((progress >= 0) AND (progress <= 100)))
);

COMMENT ON TABLE public.sow_sub_operation_progress_history IS 'Riwayat append-only update progress fisik child-task; foto disimpan ke disk (image_path).';

CREATE SEQUENCE public.sow_sub_operation_progress_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sow_sub_operation_progress_history_id_seq OWNED BY public.sow_sub_operation_progress_history.id;

CREATE TABLE public.sow_subcont_mark (
    id bigint NOT NULL,
    order_no text NOT NULL,
    operation_no integer NOT NULL,
    original_workcenter text,
    note text,
    marked_by text,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    unmarked_by text,
    unmarked_at timestamp with time zone
);

COMMENT ON TABLE public.sow_subcont_mark IS 'Penanda operasi SOW dikerjakan subcont (D4): jadwal start/finish TETAP ada, tapi jamnya dikeluarkan dari agregasi beban internal lewat predikat NOT EXISTS ber-ltrim. Tabel TERPISAH dari sow dan TANPA FK ke sow(idsow) secara sengaja: saveSowOrderRevision melakukan DELETE+INSERT dengan whitelist 33 kolom EDITABLE_SOW_COLUMNS (sowController.js:27-61), jadi kolom baru apa pun di sow dijamin hilang saat Create Revision (anomali A-01, docs/MFG_PLAN_AREA_PLAN.md) dan idsow berganti tiap revisi. Kunci logis = (ltrim(order_no,''0''), operation_no), bertahan lintas revisi.';

COMMENT ON COLUMN public.sow_subcont_mark.order_no IS 'Nomor order SAP apa adanya saat ditandai. Pencocokan SELALU lewat ltrim(order_no,''0'') — konsisten dengan seluruh kodebase (getSowOrderOperations, listBaySchedules, dll).';

COMMENT ON COLUMN public.sow_subcont_mark.original_workcenter IS 'Salinan sow.workcenter saat penandaan, untuk audit & pelaporan jam subcont per workcenter asal. HANYA salinan: sow.workcenter TIDAK PERNAH diubah (ETL etl_sync_v2.py:504-513 menimpanya tanpa syarat, jadi menaruh penanda di sana akan hilang diam-diam).';

COMMENT ON COLUMN public.sow_subcont_mark.marked_by IS 'Aktor dari header sesi x-user-name / x-user-id, BUKAN dari body request.';

COMMENT ON COLUMN public.sow_subcont_mark.unmarked_at IS 'Soft-unmark: NULL = tanda AKTIF (dipakai predikat eksklusi & index parsial). Baris tidak pernah dihapus supaya riwayat siapa menandai/membatalkan tetap ada.';

ALTER TABLE public.sow_subcont_mark ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_subcont_mark_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sow_template_lines (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    standard_id bigint NOT NULL,
    line_order integer DEFAULT 0 NOT NULL
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
    created_at timestamp without time zone DEFAULT now(),
    template_key text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.sow_templates ALTER COLUMN template_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sow_templates_template_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.sow_verification_log (
    id bigint NOT NULL,
    verification_date date DEFAULT CURRENT_DATE NOT NULL,
    production_order text NOT NULL,
    operation_no integer NOT NULL,
    machine_code text NOT NULL,
    status_before text,
    status_after text,
    deviation_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    verified_by integer,
    verified_by_name text,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    CONSTRAINT sow_verification_log_status_after_check CHECK (((status_after IS NULL) OR (status_after = ANY (ARRAY['belum'::text, 'sudah'::text, 'dilewati'::text, 'nyangkut'::text])))),
    CONSTRAINT sow_verification_log_status_before_check CHECK (((status_before IS NULL) OR (status_before = ANY (ARRAY['belum'::text, 'sudah'::text, 'dilewati'::text, 'nyangkut'::text]))))
);

CREATE SEQUENCE public.sow_verification_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.sow_verification_log_id_seq OWNED BY public.sow_verification_log.id;

ALTER TABLE public.timesheet_transaction ALTER COLUMN tsnumber ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.timesheet_transaction_tsnumber_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.tts_notification_order (
    id bigint NOT NULL,
    path_mp3 text,
    status boolean DEFAULT false NOT NULL,
    log_audio jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ssbr_id text,
    generation_status text DEFAULT 'queued'::text NOT NULL,
    error_message text,
    attempts integer DEFAULT 0 NOT NULL,
    generated_at timestamp with time zone
);

ALTER TABLE public.tts_notification_order ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.tts_notification_order_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.tts_notifications (
    id integer NOT NULL,
    order_no text NOT NULL,
    ssbr_id text,
    part_name text,
    total_planhours numeric(12,2) DEFAULT 0,
    total_actual_hours numeric(12,2) DEFAULT 0,
    remaining_hours numeric(12,2) DEFAULT 0,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.tts_notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.tts_notifications_id_seq OWNED BY public.tts_notifications.id;

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

CREATE VIEW public.v_sow_order_progress AS
 WITH teco AS (
         SELECT DISTINCT ph3_order.order_no
           FROM public.ph3_order
          WHERE (ph3_order.order_description = 'TECO'::text)
        ), wc_map AS (
         SELECT DISTINCT ON (x.code) x.code,
            x.machineid
           FROM ( SELECT (workcenter.machineid)::text AS code,
                    workcenter.machineid
                   FROM public.workcenter
                UNION ALL
                 SELECT workcenter.workcenternew,
                    workcenter.machineid
                   FROM public.workcenter
                  WHERE ((COALESCE(workcenter.workcenternew, ''::character varying))::text <> ''::text)
                UNION ALL
                 SELECT workcenter.workcenterold,
                    workcenter.machineid
                   FROM public.workcenter
                  WHERE ((COALESCE(workcenter.workcenterold, ''::character varying))::text <> ''::text)
                UNION ALL
                 SELECT workcenter.workcenterot,
                    workcenter.machineid
                   FROM public.workcenter
                  WHERE ((COALESCE(workcenter.workcenterot, ''::character varying))::text <> ''::text)) x
          ORDER BY x.code, x.machineid
        ), ov AS (
         SELECT sow_operation_status.production_order,
            sow_operation_status.operation_no,
            bool_or((sow_operation_status.manual_flag = 'nyangkut'::text)) AS any_nyangkut,
            bool_or((sow_operation_status.manual_flag = 'dilewati'::text)) AS any_dilewati
           FROM public.sow_operation_status
          GROUP BY sow_operation_status.production_order, sow_operation_status.operation_no
        ), op2 AS (
         SELECT s.order_no AS production_order,
            s.operation_no,
            s.ssbr_id,
            s.part_name,
                CASE
                    WHEN (s.status = 'FINISH'::text) THEN 'sudah'::text
                    WHEN ov.any_nyangkut THEN 'nyangkut'::text
                    WHEN ov.any_dilewati THEN 'dilewati'::text
                    ELSE 'belum'::text
                END AS eff_status,
            (wm.machineid)::text AS a_machine,
            max(s.operation_no) FILTER (WHERE (s.status = 'FINISH'::text)) OVER (PARTITION BY s.order_no) AS highest_done_op
           FROM (((public.sow s
             LEFT JOIN teco t ON (((t.order_no)::text = s.order_no)))
             LEFT JOIN ov ON (((ov.production_order = s.order_no) AND (ov.operation_no = s.operation_no))))
             LEFT JOIN wc_map wm ON ((wm.code = s.workcenter)))
          WHERE ((t.order_no IS NULL) AND (s.order_no IS NOT NULL))
        ), agg AS (
         SELECT op2.production_order,
            max(op2.highest_done_op) AS highest_done_op,
            count(*) AS total_ops,
            count(*) FILTER (WHERE (op2.eff_status = 'sudah'::text)) AS done_ops,
            min(op2.operation_no) FILTER (WHERE (op2.eff_status = ANY (ARRAY['belum'::text, 'nyangkut'::text]))) AS frontier_op,
            array_agg(op2.operation_no ORDER BY op2.operation_no) FILTER (WHERE (op2.eff_status = 'dilewati'::text)) AS debt_ops_raw,
            count(*) FILTER (WHERE (op2.eff_status = 'dilewati'::text)) AS debt_count,
            array_agg(op2.operation_no ORDER BY op2.operation_no) FILTER (WHERE (op2.eff_status = 'nyangkut'::text)) AS blocked_ops_raw,
            count(*) FILTER (WHERE (op2.eff_status = 'nyangkut'::text)) AS blocked_count,
            array_agg(op2.operation_no ORDER BY op2.operation_no) FILTER (WHERE ((op2.eff_status = ANY (ARRAY['belum'::text, 'nyangkut'::text, 'dilewati'::text])) AND (op2.highest_done_op IS NOT NULL) AND (op2.operation_no < op2.highest_done_op))) AS behind_raw,
            count(*) FILTER (WHERE (op2.eff_status = ANY (ARRAY['dilewati'::text, 'nyangkut'::text]))) AS n_manual_dev,
            count(*) FILTER (WHERE ((op2.eff_status = 'belum'::text) AND (op2.highest_done_op IS NOT NULL) AND (op2.operation_no < op2.highest_done_op))) AS n_behind_belum,
            array_agg(DISTINCT op2.ssbr_id) FILTER (WHERE (COALESCE(op2.ssbr_id, ''::text) <> ''::text)) AS ssbr_ids,
            array_agg(DISTINCT op2.part_name) FILTER (WHERE (COALESCE(op2.part_name, ''::text) <> ''::text)) AS part_names
           FROM op2
          GROUP BY op2.production_order
        )
 SELECT a.production_order,
    a.total_ops,
    a.done_ops,
    (a.total_ops - a.done_ops) AS undone_ops,
    a.highest_done_op,
    a.frontier_op,
    fo.eff_status AS frontier_status,
    fo.a_machine AS frontier_machine,
    COALESCE(a.debt_ops_raw, '{}'::integer[]) AS debt_ops,
    a.debt_count,
    COALESCE(a.blocked_ops_raw, '{}'::integer[]) AS blocked_ops,
    a.blocked_count,
    COALESCE(a.behind_raw, '{}'::integer[]) AS behind_frontier_ops,
    ((a.n_manual_dev > 0) OR (a.n_behind_belum > 0)) AS is_deviating,
        CASE
            WHEN (a.n_manual_dev > 0) THEN 'red'::text
            WHEN (a.n_behind_belum > 0) THEN 'amber'::text
            ELSE 'green'::text
        END AS status_color,
    NULL::date AS last_activity_date,
    COALESCE(a.ssbr_ids, '{}'::text[]) AS ssbr_ids,
    COALESCE(a.part_names, '{}'::text[]) AS part_names
   FROM (agg a
     LEFT JOIN op2 fo ON (((fo.production_order = a.production_order) AND (fo.operation_no = a.frontier_op))));

CREATE VIEW public.vw_sow_planned_queue_vs_actual_queue AS
 WITH planned AS (
         SELECT sc.id,
            sc.sow_id,
            sc.production_order,
            sc.operation_no,
            sc.sequence,
            sc.ssbr_id,
            sc.workcenter,
            sc.machine_code,
            sc.schedule_date,
            sc.shift_id,
            sc.planned_start_datetime,
            sc.planned_end_datetime,
            sc.planned_hours,
            sc.planned_queue_no,
            sc.priority_no,
            sc.schedule_status,
            sc.schedule_source_type,
            sc.batch_id,
            sc.is_overtime,
            sc.overtime_request_id,
            sc.warning_flag,
            sc.warning_message,
            sc.remarks,
            sc.created_by_user_id,
            sc.created_by_name,
            sc.created_at,
            sc.updated_at,
            sd.shift_code,
            sd.shift_name,
            row_number() OVER (PARTITION BY sc.machine_code, sc.schedule_date, sc.shift_id ORDER BY sc.planned_queue_no, sc.planned_start_datetime, sc.id) AS planned_rank
           FROM (public.sow_schedule sc
             LEFT JOIN public.shift_definition sd ON ((sd.id = sc.shift_id)))
          WHERE ((sc.schedule_status = ANY (ARRAY['PLANNED'::text, 'PARTIAL'::text, 'COMPLETED'::text])) AND (sc.is_overtime = false))
        ), actual AS (
         SELECT bt.id,
            bt.machine_id,
            bt.type,
            bt.component_id,
            bt.component_label,
            bt."timestamp",
            bt.reference_no,
            bt.note,
            bt.created_at,
            bt.order_no,
            bt.ssbr_id,
            bt.operation_no,
            bt.operation_text,
            bt.priority,
            bt.updated_at,
            row_number() OVER (PARTITION BY bt.machine_id, ((bt."timestamp")::date) ORDER BY bt.priority, bt."timestamp", bt.id) AS actual_queue_no
           FROM public.buffer_transaction bt
        ), planned_rows AS (
         SELECT p.schedule_date,
            p.shift_id,
            p.shift_code,
            p.shift_name,
            p.machine_code,
            p.workcenter,
            p.production_order,
            p.operation_no,
            (COALESCE((p.planned_queue_no)::bigint, p.planned_rank))::integer AS planned_queue_no,
            p.planned_start_datetime,
            p.planned_end_datetime,
            (a.actual_queue_no)::integer AS actual_queue_no,
            a."timestamp" AS actual_queue_datetime,
                CASE
                    WHEN (a.actual_queue_no IS NULL) THEN NULL::integer
                    ELSE ((a.actual_queue_no - COALESCE((p.planned_queue_no)::bigint, p.planned_rank)))::integer
                END AS queue_variance,
                CASE
                    WHEN (a.id IS NULL) THEN 'PLANNED_NOT_YET_ACTUAL'::text
                    WHEN (a.machine_id IS DISTINCT FROM p.machine_code) THEN 'MACHINE_CHANGED'::text
                    WHEN (a.actual_queue_no = COALESCE((p.planned_queue_no)::bigint, p.planned_rank)) THEN 'ON_PLAN'::text
                    WHEN (a.actual_queue_no < COALESCE((p.planned_queue_no)::bigint, p.planned_rank)) THEN 'EARLY'::text
                    WHEN (a.actual_queue_no > COALESCE((p.planned_queue_no)::bigint, p.planned_rank)) THEN 'LATE'::text
                    ELSE 'ON_PLAN'::text
                END AS comparison_status
           FROM (planned p
             LEFT JOIN LATERAL ( SELECT a_1.id,
                    a_1.machine_id,
                    a_1.type,
                    a_1.component_id,
                    a_1.component_label,
                    a_1."timestamp",
                    a_1.reference_no,
                    a_1.note,
                    a_1.created_at,
                    a_1.order_no,
                    a_1.ssbr_id,
                    a_1.operation_no,
                    a_1.operation_text,
                    a_1.priority,
                    a_1.updated_at,
                    a_1.actual_queue_no
                   FROM actual a_1
                  WHERE ((ltrim(COALESCE(a_1.order_no, ''::text), '0'::text) = ltrim(COALESCE(p.production_order, ''::text), '0'::text)) AND (a_1.operation_no = p.operation_no) AND (a_1."timestamp" >= p.planned_start_datetime) AND (a_1."timestamp" < p.planned_end_datetime))
                  ORDER BY
                        CASE
                            WHEN (a_1.machine_id = p.machine_code) THEN 0
                            ELSE 1
                        END, a_1."timestamp", a_1.id
                 LIMIT 1) a ON (true))
        ), unplanned_actual AS (
         SELECT (a."timestamp")::date AS schedule_date,
            NULL::bigint AS shift_id,
            NULL::text AS shift_code,
            NULL::text AS shift_name,
            a.machine_id AS machine_code,
            NULL::text AS workcenter,
            a.order_no AS production_order,
            a.operation_no,
            NULL::integer AS planned_queue_no,
            NULL::timestamp with time zone AS planned_start_datetime,
            NULL::timestamp with time zone AS planned_end_datetime,
            (a.actual_queue_no)::integer AS actual_queue_no,
            a."timestamp" AS actual_queue_datetime,
            NULL::integer AS queue_variance,
            'UNPLANNED_ACTUAL'::text AS comparison_status
           FROM actual a
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM planned p
                  WHERE ((ltrim(COALESCE(a.order_no, ''::text), '0'::text) = ltrim(COALESCE(p.production_order, ''::text), '0'::text)) AND (a.operation_no = p.operation_no) AND (a."timestamp" >= p.planned_start_datetime) AND (a."timestamp" < p.planned_end_datetime)))))
        )
 SELECT planned_rows.schedule_date,
    planned_rows.shift_id,
    planned_rows.shift_code,
    planned_rows.shift_name,
    planned_rows.machine_code,
    planned_rows.workcenter,
    planned_rows.production_order,
    planned_rows.operation_no,
    planned_rows.planned_queue_no,
    planned_rows.planned_start_datetime,
    planned_rows.planned_end_datetime,
    planned_rows.actual_queue_no,
    planned_rows.actual_queue_datetime,
    planned_rows.queue_variance,
    planned_rows.comparison_status
   FROM planned_rows
UNION ALL
 SELECT unplanned_actual.schedule_date,
    unplanned_actual.shift_id,
    unplanned_actual.shift_code,
    unplanned_actual.shift_name,
    unplanned_actual.machine_code,
    unplanned_actual.workcenter,
    unplanned_actual.production_order,
    unplanned_actual.operation_no,
    unplanned_actual.planned_queue_no,
    unplanned_actual.planned_start_datetime,
    unplanned_actual.planned_end_datetime,
    unplanned_actual.actual_queue_no,
    unplanned_actual.actual_queue_datetime,
    unplanned_actual.queue_variance,
    unplanned_actual.comparison_status
   FROM unplanned_actual;

CREATE VIEW public.vw_sow_operation_actual AS
 WITH contrib AS (
         SELECT sc.schedule_date,
            sc.shift_id,
            sc.machine_code,
            COALESCE(NULLIF(sc.workcenter, ''::text), sc.machine_code) AS workcenter,
            sc.production_order,
            sc.operation_no,
            sum(sc.planned_hours) FILTER (WHERE ((sc.schedule_status = ANY (ARRAY['PLANNED'::text, 'PARTIAL'::text, 'COMPLETED'::text])) AND (sc.is_overtime = false))) AS normal_planned_hours,
            sum(sc.planned_hours) FILTER (WHERE (sc.schedule_status = 'UNPLANNED'::text)) AS unplanned_hours,
            NULL::numeric AS overtime_pending_hours,
            NULL::numeric AS overtime_approved_hours,
            NULL::numeric AS actual_hours
           FROM public.sow_schedule sc
          WHERE (sc.schedule_status <> 'CANCELLED'::text)
          GROUP BY sc.schedule_date, sc.shift_id, sc.machine_code, COALESCE(NULLIF(sc.workcenter, ''::text), sc.machine_code), sc.production_order, sc.operation_no
        UNION ALL
         SELECT o.overtime_date,
            o.shift_id,
            o.machine_code,
            COALESCE(NULLIF(o.workcenter, ''::text), o.machine_code) AS "coalesce",
            o.production_order,
            o.operation_no,
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            sum(o.overtime_hours) FILTER (WHERE (o.request_status = 'PENDING'::text)) AS sum,
            sum(o.overtime_hours) FILTER (WHERE (o.request_status = 'APPROVED'::text)) AS sum,
            NULL::numeric AS "numeric"
           FROM public.sow_overtime_request o
          WHERE (o.request_status <> 'CANCELLED'::text)
          GROUP BY o.overtime_date, o.shift_id, o.machine_code, COALESCE(NULLIF(o.workcenter, ''::text), o.machine_code), o.production_order, o.operation_no
        UNION ALL
         SELECT sb.schedule_date,
            sb.shift_id,
            sb.machine_code,
            COALESCE(NULLIF(sb.workcenter, ''::text), sb.machine_code) AS "coalesce",
            sb.production_order,
            sb.operation_no,
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            sum(COALESCE(tt.duration, (EXTRACT(epoch FROM (COALESCE(tt.longdate_checkout, now()) - tt.longdate_checkin)) / (3600)::numeric))) AS sum
           FROM (public.sow_schedule sb
             JOIN public.timesheet_transaction tt ON (((ltrim(COALESCE(tt.order_no, ''::text), '0'::text) = ltrim(COALESCE(sb.production_order, ''::text), '0'::text)) AND (tt.operation_no = sb.operation_no) AND (tt.longdate_checkin >= sb.planned_start_datetime) AND (tt.longdate_checkin < sb.planned_end_datetime))))
          WHERE ((sb.schedule_status <> 'CANCELLED'::text) AND (sb.planned_start_datetime IS NOT NULL) AND (sb.planned_end_datetime IS NOT NULL) AND (tt.longdate_checkin IS NOT NULL) AND (tt.activitytype IS NULL))
          GROUP BY sb.schedule_date, sb.shift_id, sb.machine_code, COALESCE(NULLIF(sb.workcenter, ''::text), sb.machine_code), sb.production_order, sb.operation_no
        UNION ALL
         SELECT (tt.longdate_checkin)::date AS longdate_checkin,
            NULL::bigint AS int8,
            (COALESCE(wc_1.machineid, (tt.workcentercode)::character varying))::text AS "coalesce",
            COALESCE(tt.workcentercode, (wc_1.machineid)::text) AS "coalesce",
            tt.order_no,
            tt.operation_no,
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            sum(COALESCE(tt.duration, (EXTRACT(epoch FROM (COALESCE(tt.longdate_checkout, now()) - tt.longdate_checkin)) / (3600)::numeric))) AS sum
           FROM (public.timesheet_transaction tt
             LEFT JOIN LATERAL ( SELECT w.machineid
                   FROM public.workcenter w
                  WHERE ((tt.workcentercode = (w.workcenternew)::text) OR (tt.workcentercode = (w.workcenterold)::text) OR (tt.workcentercode = (w.workcenterot)::text) OR (tt.workcentercode = (w.machineid)::text))
                  ORDER BY w."position", w.machineid
                 LIMIT 1) wc_1 ON (true))
          WHERE ((tt.longdate_checkin IS NOT NULL) AND (tt.activitytype IS NULL) AND (NOT (EXISTS ( SELECT 1
                   FROM public.sow_schedule sb
                  WHERE ((sb.schedule_status <> 'CANCELLED'::text) AND (ltrim(COALESCE(tt.order_no, ''::text), '0'::text) = ltrim(COALESCE(sb.production_order, ''::text), '0'::text)) AND (tt.operation_no = sb.operation_no) AND (tt.longdate_checkin >= sb.planned_start_datetime) AND (tt.longdate_checkin < sb.planned_end_datetime))))))
          GROUP BY ((tt.longdate_checkin)::date), COALESCE(wc_1.machineid, (tt.workcentercode)::character varying), COALESCE(tt.workcentercode, (wc_1.machineid)::text), tt.order_no, tt.operation_no
        ), pvh AS (
         SELECT contrib.schedule_date,
            contrib.shift_id,
            contrib.machine_code,
            contrib.workcenter,
            contrib.production_order,
            contrib.operation_no,
            (COALESCE(sum(contrib.normal_planned_hours), (0)::numeric))::numeric(10,2) AS normal_planned_hours,
            (COALESCE(sum(contrib.unplanned_hours), (0)::numeric))::numeric(10,2) AS unplanned_hours,
            (COALESCE(sum(contrib.overtime_pending_hours), (0)::numeric))::numeric(10,2) AS overtime_pending_hours,
            (COALESCE(sum(contrib.overtime_approved_hours), (0)::numeric))::numeric(10,2) AS overtime_approved_hours,
            (COALESCE(sum(contrib.actual_hours), (0)::numeric))::numeric(10,2) AS actual_hours
           FROM contrib
          GROUP BY contrib.schedule_date, contrib.shift_id, contrib.machine_code, contrib.workcenter, contrib.production_order, contrib.operation_no
        ), hours AS (
         SELECT pvh.schedule_date,
            pvh.machine_code,
            pvh.production_order,
            pvh.operation_no,
            (sum(pvh.normal_planned_hours))::numeric(10,2) AS normal_planned_hours,
            (sum(pvh.unplanned_hours))::numeric(10,2) AS unplanned_hours,
            (sum(pvh.overtime_pending_hours))::numeric(10,2) AS overtime_pending_hours,
            (sum(pvh.overtime_approved_hours))::numeric(10,2) AS overtime_approved_hours,
            (sum(pvh.actual_hours))::numeric(10,2) AS actual_hours
           FROM pvh
          GROUP BY pvh.schedule_date, pvh.machine_code, pvh.production_order, pvh.operation_no
        ), queue AS (
         SELECT DISTINCT ON (qq.schedule_date, qq.machine_code, qq.production_order, qq.operation_no) qq.schedule_date,
            qq.machine_code,
            qq.production_order,
            qq.operation_no,
            qq.planned_queue_no,
            qq.actual_queue_no,
            qq.queue_variance,
            qq.comparison_status
           FROM public.vw_sow_planned_queue_vs_actual_queue qq
          ORDER BY qq.schedule_date, qq.machine_code, qq.production_order, qq.operation_no,
                CASE qq.comparison_status
                    WHEN 'MACHINE_CHANGED'::text THEN 0
                    WHEN 'LATE'::text THEN 1
                    WHEN 'EARLY'::text THEN 2
                    WHEN 'ON_PLAN'::text THEN 3
                    WHEN 'UNPLANNED_ACTUAL'::text THEN 4
                    WHEN 'PLANNED_NOT_YET_ACTUAL'::text THEN 5
                    ELSE 6
                END, (abs(COALESCE(qq.queue_variance, 0))) DESC, qq.actual_queue_datetime, qq.actual_queue_no, qq.planned_queue_no
        )
 SELECT h.schedule_date,
    h.machine_code,
    wc.workcenter_description AS machine_name,
    h.production_order,
    h.operation_no,
    h.normal_planned_hours,
    h.unplanned_hours,
    h.overtime_pending_hours,
    h.overtime_approved_hours,
    h.actual_hours,
    (((h.actual_hours - h.normal_planned_hours) - h.overtime_approved_hours))::numeric(10,2) AS variance_hours,
        CASE
            WHEN ((h.normal_planned_hours = (0)::numeric) AND (h.actual_hours > (0)::numeric)) THEN 'UNPLANNED_ACTUAL'::text
            WHEN (h.unplanned_hours > (0)::numeric) THEN 'PARTIAL'::text
            WHEN (h.normal_planned_hours > (0)::numeric) THEN 'PLANNED'::text
            ELSE 'NO_PLAN'::text
        END AS planned_status,
        CASE
            WHEN (h.overtime_pending_hours > (0)::numeric) THEN 'PENDING'::text
            WHEN (h.overtime_approved_hours > (0)::numeric) THEN 'APPROVED'::text
            ELSE 'NONE'::text
        END AS overtime_status,
    q.planned_queue_no,
    q.actual_queue_no,
    q.queue_variance,
    q.comparison_status,
        CASE
            WHEN (COALESCE(h.actual_hours, (0)::numeric) > (0)::numeric) THEN 'sudah'::text
            ELSE 'belum'::text
        END AS view_status,
    s.id AS manual_status_id,
    s.manual_flag,
    s.blocked_reason,
    s.blocked_by_machine_code,
    s.blocked_by_order,
        CASE
            WHEN (s.manual_flag = 'nyangkut'::text) THEN 'nyangkut'::text
            WHEN (s.manual_flag = 'dilewati'::text) THEN 'dilewati'::text
            WHEN (COALESCE(h.actual_hours, (0)::numeric) > (0)::numeric) THEN 'sudah'::text
            ELSE 'belum'::text
        END AS effective_status,
    (s.id IS NOT NULL) AS is_overridden,
    s.override_note AS overridden_note,
    s.updated_by AS overridden_by,
    s.updated_by_name AS overridden_by_name,
    s.updated_at AS overridden_at,
    COALESCE((q.comparison_status = 'MACHINE_CHANGED'::text), false) AS machine_deviation,
    COALESCE(((q.queue_variance IS NOT NULL) AND (q.queue_variance <> 0)), false) AS sequence_deviation
   FROM (((hours h
     LEFT JOIN LATERAL ( SELECT w.workcenter_description
           FROM public.workcenter w
          WHERE ((w.machineid)::text = h.machine_code)
         LIMIT 1) wc ON (true))
     LEFT JOIN queue q ON (((q.schedule_date = h.schedule_date) AND (q.machine_code = h.machine_code) AND (q.production_order = h.production_order) AND (q.operation_no = h.operation_no))))
     LEFT JOIN public.sow_operation_status s ON (((s.production_order = h.production_order) AND (s.operation_no = h.operation_no) AND (s.machine_code = h.machine_code) AND (s.status_date = h.schedule_date))));

CREATE VIEW public.vw_sow_orders AS
 SELECT sow.order_no,
    min(sow.ssbr_id) AS ssbr_id,
    min(sow.part_number) AS part_number,
    min(sow.part_name) AS part_name,
    min(sow.model) AS model,
    min(sow.customer) AS customer,
    min(sow.location) AS location,
    min(sow.systemstatus) AS systemstatus,
    sum(sow.planhours) AS total_planhours,
    count(*) AS operation_count,
    round(avg(sow.progress) FILTER (WHERE (sow.progress IS NOT NULL)), 1) AS avg_progress
   FROM public.sow
  GROUP BY sow.order_no;

CREATE VIEW public.vw_sow_overtime_summary AS
 SELECT sow_overtime_request.id,
    sow_overtime_request.overtime_date,
    sow_overtime_request.shift_id,
    NULL::text AS shift_code,
    NULL::text AS shift_name,
    sow_overtime_request.machine_code,
    sow_overtime_request.workcenter,
    sow_overtime_request.production_order,
    sow_overtime_request.operation_no,
    sow_overtime_request.overtime_start_datetime,
    sow_overtime_request.overtime_end_datetime,
    sow_overtime_request.overtime_hours,
    sow_overtime_request.request_status,
    sow_overtime_request.requested_by_name AS requested_by,
    sow_overtime_request.approved_by_name AS approved_by,
    sow_overtime_request.approved_at,
    sow_overtime_request.rejected_by_name AS rejected_by,
    sow_overtime_request.rejected_at,
    sow_overtime_request.warning_flag,
    sow_overtime_request.warning_message,
    sow_overtime_request.note,
    sow_overtime_request.created_at,
    sow_overtime_request.updated_at,
    sow_overtime_request.overtime_date AS schedule_date,
    sow_overtime_request.assigned_to,
    sow_overtime_request.assigned_to_name,
    sow_overtime_request.assigned_by,
    sow_overtime_request.rejection_note,
    sow_overtime_request.requested_by_name,
    sow_overtime_request.requested_by_user_id,
    sow_overtime_request.approved_by_name,
    sow_overtime_request.approved_by_user_id,
    sow_overtime_request.rejected_by_name,
    sow_overtime_request.rejected_by_user_id
   FROM public.sow_overtime_request;

CREATE VIEW public.vw_sow_plan_vs_actual_hours AS
 WITH schedule_base AS (
         SELECT sc.id,
            sc.sow_id,
            sc.production_order,
            sc.operation_no,
            sc.sequence,
            sc.ssbr_id,
            sc.workcenter,
            sc.machine_code,
            sc.schedule_date,
            sc.shift_id,
            sc.planned_start_datetime,
            sc.planned_end_datetime,
            sc.planned_hours,
            sc.planned_queue_no,
            sc.priority_no,
            sc.schedule_status,
            sc.schedule_source_type,
            sc.batch_id,
            sc.is_overtime,
            sc.overtime_request_id,
            sc.warning_flag,
            sc.warning_message,
            sc.remarks,
            sc.created_by_user_id,
            sc.created_by_name,
            sc.created_at,
            sc.updated_at,
            wc.workcenternew,
            wc.workcenterold,
            wc.workcenterot
           FROM (public.sow_schedule sc
             LEFT JOIN public.workcenter wc ON (((wc.machineid)::text = sc.machine_code)))
          WHERE (sc.schedule_status <> 'CANCELLED'::text)
        ), normal_plan AS (
         SELECT schedule_base.schedule_date,
            schedule_base.shift_id,
            schedule_base.machine_code,
            COALESCE(NULLIF(schedule_base.workcenter, ''::text), schedule_base.machine_code) AS workcenter,
            schedule_base.production_order,
            schedule_base.operation_no,
            sum(schedule_base.planned_hours) FILTER (WHERE ((schedule_base.schedule_status = ANY (ARRAY['PLANNED'::text, 'PARTIAL'::text, 'COMPLETED'::text])) AND (schedule_base.is_overtime = false))) AS normal_planned_hours,
            sum(schedule_base.planned_hours) FILTER (WHERE (schedule_base.schedule_status = 'UNPLANNED'::text)) AS unplanned_hours
           FROM schedule_base
          GROUP BY schedule_base.schedule_date, schedule_base.shift_id, schedule_base.machine_code, COALESCE(NULLIF(schedule_base.workcenter, ''::text), schedule_base.machine_code), schedule_base.production_order, schedule_base.operation_no
        ), overtime_plan AS (
         SELECT sow_overtime_request.overtime_date AS schedule_date,
            sow_overtime_request.shift_id,
            sow_overtime_request.machine_code,
            COALESCE(NULLIF(sow_overtime_request.workcenter, ''::text), sow_overtime_request.machine_code) AS workcenter,
            sow_overtime_request.production_order,
            sow_overtime_request.operation_no,
            sum(sow_overtime_request.overtime_hours) FILTER (WHERE (sow_overtime_request.request_status = 'PENDING'::text)) AS overtime_pending_hours,
            sum(sow_overtime_request.overtime_hours) FILTER (WHERE (sow_overtime_request.request_status = 'APPROVED'::text)) AS overtime_approved_hours,
            max(sow_overtime_request.approved_by_name) FILTER (WHERE (sow_overtime_request.request_status = 'APPROVED'::text)) AS approved_by,
            max(sow_overtime_request.approved_at) FILTER (WHERE (sow_overtime_request.request_status = 'APPROVED'::text)) AS approved_at
           FROM public.sow_overtime_request
          WHERE (sow_overtime_request.request_status <> 'CANCELLED'::text)
          GROUP BY sow_overtime_request.overtime_date, sow_overtime_request.shift_id, sow_overtime_request.machine_code, COALESCE(NULLIF(sow_overtime_request.workcenter, ''::text), sow_overtime_request.machine_code), sow_overtime_request.production_order, sow_overtime_request.operation_no
        ), actual_matched AS (
         SELECT sb.schedule_date,
            sb.shift_id,
            sb.machine_code,
            COALESCE(NULLIF(sb.workcenter, ''::text), sb.machine_code) AS workcenter,
            sb.production_order,
            sb.operation_no,
            sum(COALESCE(tt.duration, (EXTRACT(epoch FROM (COALESCE(tt.longdate_checkout, now()) - tt.longdate_checkin)) / (3600)::numeric))) AS actual_hours
           FROM (schedule_base sb
             JOIN public.timesheet_transaction tt ON (((ltrim(COALESCE(tt.order_no, ''::text), '0'::text) = ltrim(COALESCE(sb.production_order, ''::text), '0'::text)) AND (tt.operation_no = sb.operation_no) AND (tt.longdate_checkin >= sb.planned_start_datetime) AND (tt.longdate_checkin < sb.planned_end_datetime))))
          WHERE ((sb.planned_start_datetime IS NOT NULL) AND (sb.planned_end_datetime IS NOT NULL) AND (tt.longdate_checkin IS NOT NULL) AND (tt.activitytype IS NULL))
          GROUP BY sb.schedule_date, sb.shift_id, sb.machine_code, COALESCE(NULLIF(sb.workcenter, ''::text), sb.machine_code), sb.production_order, sb.operation_no
        ), actual_unplanned AS (
         SELECT (tt.longdate_checkin)::date AS schedule_date,
            NULL::bigint AS shift_id,
            COALESCE(wc.machineid, (tt.workcentercode)::character varying) AS machine_code,
            COALESCE(tt.workcentercode, (wc.machineid)::text) AS workcenter,
            tt.order_no AS production_order,
            tt.operation_no,
            sum(COALESCE(tt.duration, (EXTRACT(epoch FROM (COALESCE(tt.longdate_checkout, now()) - tt.longdate_checkin)) / (3600)::numeric))) AS actual_hours
           FROM (public.timesheet_transaction tt
             LEFT JOIN LATERAL ( SELECT w.machineid
                   FROM public.workcenter w
                  WHERE ((tt.workcentercode = (w.workcenternew)::text) OR (tt.workcentercode = (w.workcenterold)::text) OR (tt.workcentercode = (w.workcenterot)::text) OR (tt.workcentercode = (w.machineid)::text))
                  ORDER BY w."position", w.machineid
                 LIMIT 1) wc ON (true))
          WHERE ((tt.longdate_checkin IS NOT NULL) AND (tt.activitytype IS NULL) AND (NOT (EXISTS ( SELECT 1
                   FROM schedule_base sb
                  WHERE ((ltrim(COALESCE(tt.order_no, ''::text), '0'::text) = ltrim(COALESCE(sb.production_order, ''::text), '0'::text)) AND (tt.operation_no = sb.operation_no) AND (tt.longdate_checkin >= sb.planned_start_datetime) AND (tt.longdate_checkin < sb.planned_end_datetime))))))
          GROUP BY ((tt.longdate_checkin)::date), COALESCE(wc.machineid, (tt.workcentercode)::character varying), COALESCE(tt.workcentercode, (wc.machineid)::text), tt.order_no, tt.operation_no
        ), report_keys AS (
         SELECT normal_plan.schedule_date,
            normal_plan.shift_id,
            normal_plan.machine_code,
            normal_plan.workcenter,
            normal_plan.production_order,
            normal_plan.operation_no
           FROM normal_plan
        UNION
         SELECT overtime_plan.schedule_date,
            overtime_plan.shift_id,
            overtime_plan.machine_code,
            overtime_plan.workcenter,
            overtime_plan.production_order,
            overtime_plan.operation_no
           FROM overtime_plan
        UNION
         SELECT actual_matched.schedule_date,
            actual_matched.shift_id,
            actual_matched.machine_code,
            actual_matched.workcenter,
            actual_matched.production_order,
            actual_matched.operation_no
           FROM actual_matched
        UNION
         SELECT actual_unplanned.schedule_date,
            actual_unplanned.shift_id,
            actual_unplanned.machine_code,
            actual_unplanned.workcenter,
            actual_unplanned.production_order,
            actual_unplanned.operation_no
           FROM actual_unplanned
        )
 SELECT k.schedule_date,
    k.shift_id,
    sd.shift_code,
    sd.shift_name,
    k.machine_code,
    k.workcenter,
    k.production_order,
    k.operation_no,
    (COALESCE(np.normal_planned_hours, (0)::numeric))::numeric(10,2) AS normal_planned_hours,
    (COALESCE(np.unplanned_hours, (0)::numeric))::numeric(10,2) AS unplanned_hours,
    (COALESCE(op.overtime_pending_hours, (0)::numeric))::numeric(10,2) AS overtime_pending_hours,
    (COALESCE(op.overtime_approved_hours, (0)::numeric))::numeric(10,2) AS overtime_approved_hours,
    ((COALESCE(np.normal_planned_hours, (0)::numeric) + COALESCE(op.overtime_approved_hours, (0)::numeric)))::numeric(10,2) AS total_approved_planned_hours,
    ((COALESCE(am.actual_hours, (0)::numeric) + COALESCE(au.actual_hours, (0)::numeric)))::numeric(10,2) AS actual_hours,
    ((((COALESCE(am.actual_hours, (0)::numeric) + COALESCE(au.actual_hours, (0)::numeric)) - COALESCE(np.normal_planned_hours, (0)::numeric)) - COALESCE(op.overtime_approved_hours, (0)::numeric)))::numeric(10,2) AS variance_hours,
        CASE
            WHEN ((COALESCE(np.normal_planned_hours, (0)::numeric) = (0)::numeric) AND (COALESCE(au.actual_hours, (0)::numeric) > (0)::numeric)) THEN 'UNPLANNED_ACTUAL'::text
            WHEN (COALESCE(np.unplanned_hours, (0)::numeric) > (0)::numeric) THEN 'PARTIAL'::text
            WHEN (COALESCE(np.normal_planned_hours, (0)::numeric) > (0)::numeric) THEN 'PLANNED'::text
            ELSE 'NO_PLAN'::text
        END AS planned_status,
        CASE
            WHEN (COALESCE(op.overtime_pending_hours, (0)::numeric) > (0)::numeric) THEN 'PENDING'::text
            WHEN (COALESCE(op.overtime_approved_hours, (0)::numeric) > (0)::numeric) THEN 'APPROVED'::text
            ELSE 'NONE'::text
        END AS overtime_status,
    op.approved_by,
    op.approved_at
   FROM (((((report_keys k
     LEFT JOIN public.shift_definition sd ON ((sd.id = k.shift_id)))
     LEFT JOIN normal_plan np ON (((np.schedule_date = k.schedule_date) AND (NOT (np.shift_id IS DISTINCT FROM k.shift_id)) AND (NOT (np.machine_code IS DISTINCT FROM k.machine_code)) AND (NOT (np.workcenter IS DISTINCT FROM k.workcenter)) AND (NOT (np.production_order IS DISTINCT FROM k.production_order)) AND (NOT (np.operation_no IS DISTINCT FROM k.operation_no)))))
     LEFT JOIN overtime_plan op ON (((op.schedule_date = k.schedule_date) AND (NOT (op.shift_id IS DISTINCT FROM k.shift_id)) AND (NOT (op.machine_code IS DISTINCT FROM k.machine_code)) AND (NOT (op.workcenter IS DISTINCT FROM k.workcenter)) AND (NOT (op.production_order IS DISTINCT FROM k.production_order)) AND (NOT (op.operation_no IS DISTINCT FROM k.operation_no)))))
     LEFT JOIN actual_matched am ON (((am.schedule_date = k.schedule_date) AND (NOT (am.shift_id IS DISTINCT FROM k.shift_id)) AND (NOT (am.machine_code IS DISTINCT FROM k.machine_code)) AND (NOT (am.workcenter IS DISTINCT FROM k.workcenter)) AND (NOT (am.production_order IS DISTINCT FROM k.production_order)) AND (NOT (am.operation_no IS DISTINCT FROM k.operation_no)))))
     LEFT JOIN actual_unplanned au ON (((au.schedule_date = k.schedule_date) AND (NOT (au.shift_id IS DISTINCT FROM k.shift_id)) AND (NOT ((au.machine_code)::text IS DISTINCT FROM k.machine_code)) AND (NOT (au.workcenter IS DISTINCT FROM k.workcenter)) AND (NOT (au.production_order IS DISTINCT FROM k.production_order)) AND (NOT (au.operation_no IS DISTINCT FROM k.operation_no)))));

CREATE VIEW public.vw_sow_schedule_capacity AS
 WITH schedule_usage AS (
         SELECT sow_schedule.schedule_date,
            sow_schedule.shift_id,
            sow_schedule.machine_code,
            COALESCE(NULLIF(sow_schedule.workcenter, ''::text), sow_schedule.machine_code) AS workcenter,
            sum(sow_schedule.planned_hours) FILTER (WHERE ((sow_schedule.schedule_status = ANY (ARRAY['PLANNED'::text, 'PARTIAL'::text, 'COMPLETED'::text])) AND (sow_schedule.is_overtime = false))) AS used_normal_planned_hours,
            sum(sow_schedule.planned_hours) FILTER (WHERE (sow_schedule.schedule_status = 'UNPLANNED'::text)) AS unplanned_hours
           FROM public.sow_schedule
          WHERE (sow_schedule.schedule_status <> 'CANCELLED'::text)
          GROUP BY sow_schedule.schedule_date, sow_schedule.shift_id, sow_schedule.machine_code, COALESCE(NULLIF(sow_schedule.workcenter, ''::text), sow_schedule.machine_code)
        ), overtime_usage AS (
         SELECT sow_overtime_request.overtime_date AS schedule_date,
            sow_overtime_request.shift_id,
            sow_overtime_request.machine_code,
            COALESCE(NULLIF(sow_overtime_request.workcenter, ''::text), sow_overtime_request.machine_code) AS workcenter,
            sum(sow_overtime_request.overtime_hours) FILTER (WHERE (sow_overtime_request.request_status = 'PENDING'::text)) AS pending_overtime_hours,
            sum(sow_overtime_request.overtime_hours) FILTER (WHERE (sow_overtime_request.request_status = 'APPROVED'::text)) AS approved_overtime_hours
           FROM public.sow_overtime_request
          WHERE (sow_overtime_request.request_status <> 'CANCELLED'::text)
          GROUP BY sow_overtime_request.overtime_date, sow_overtime_request.shift_id, sow_overtime_request.machine_code, COALESCE(NULLIF(sow_overtime_request.workcenter, ''::text), sow_overtime_request.machine_code)
        ), report_keys AS (
         SELECT sow_machine_capacity.schedule_date,
            sow_machine_capacity.shift_id,
            sow_machine_capacity.machine_code,
            COALESCE(NULLIF(sow_machine_capacity.workcenter, ''::text), sow_machine_capacity.machine_code) AS workcenter
           FROM public.sow_machine_capacity
          WHERE (sow_machine_capacity.is_active = true)
        UNION
         SELECT schedule_usage.schedule_date,
            schedule_usage.shift_id,
            schedule_usage.machine_code,
            schedule_usage.workcenter
           FROM schedule_usage
        UNION
         SELECT overtime_usage.schedule_date,
            overtime_usage.shift_id,
            overtime_usage.machine_code,
            overtime_usage.workcenter
           FROM overtime_usage
        )
 SELECT k.schedule_date,
    k.shift_id,
    sd.shift_code,
    sd.shift_name,
    k.machine_code,
    k.workcenter,
    COALESCE(cap.capacity_type, 'STANDARD'::text) AS capacity_type,
    (COALESCE(NULLIF(cap.total_capacity_hours, (0)::numeric), sd.default_capacity_hours, (0)::numeric))::numeric(10,2) AS total_capacity_hours,
    (COALESCE(su.used_normal_planned_hours, (0)::numeric))::numeric(10,2) AS used_normal_planned_hours,
    (GREATEST((COALESCE(NULLIF(cap.total_capacity_hours, (0)::numeric), sd.default_capacity_hours, (0)::numeric) - COALESCE(su.used_normal_planned_hours, (0)::numeric)), (0)::numeric))::numeric(10,2) AS remaining_capacity_hours,
    (COALESCE(su.unplanned_hours, (0)::numeric))::numeric(10,2) AS unplanned_hours,
    (COALESCE(ou.pending_overtime_hours, (0)::numeric))::numeric(10,2) AS pending_overtime_hours,
    (COALESCE(ou.approved_overtime_hours, (0)::numeric))::numeric(10,2) AS approved_overtime_hours
   FROM ((((report_keys k
     JOIN public.shift_definition sd ON ((sd.id = k.shift_id)))
     LEFT JOIN public.sow_machine_capacity cap ON (((cap.schedule_date = k.schedule_date) AND (cap.shift_id = k.shift_id) AND (cap.machine_code = k.machine_code) AND (cap.is_active = true))))
     LEFT JOIN schedule_usage su ON (((su.schedule_date = k.schedule_date) AND (su.shift_id = k.shift_id) AND (su.machine_code = k.machine_code) AND (su.workcenter = k.workcenter))))
     LEFT JOIN overtime_usage ou ON (((ou.schedule_date = k.schedule_date) AND (ou.shift_id = k.shift_id) AND (ou.machine_code = k.machine_code) AND (ou.workcenter = k.workcenter))));

CREATE VIEW public.vw_timesheet_std_performance AS
 WITH productive AS (
         SELECT t.tsnumber,
            t.confirmationnumber,
            t.full_name,
            t.ssbr_id,
            s.order_no,
            s.operation_no,
            t.operation_text,
            t.hour_checkin,
            t.hour_checkout,
            t.longdate_checkin,
            t.longdate_checkout,
            t.part_name,
            t.planhours,
            t.plant,
            t.serialnumber,
            t.state_flag,
            t.std_foreman_hours,
            t.validation_date,
            t.workcentercode,
            t.workcenterdescription,
            t.duration,
            t.modified_at,
            t.activitytype,
            t.date_checkin,
            t.date_checkout,
            t.note,
            s.planhours AS sow_planhours,
            (COALESCE(s.planhours, (0)::numeric) * (3600)::numeric) AS sow_plan_seconds,
                CASE
                    WHEN (t.tsnumber IS NULL) THEN (0)::numeric
                    ELSE GREATEST(EXTRACT(epoch FROM (COALESCE(t.longdate_checkout, t.longdate_checkin) - t.longdate_checkin)), (0)::numeric)
                END AS elapsed_seconds
           FROM (public.sow s
             LEFT JOIN public.timesheet_transaction t ON (((t.order_no = s.order_no) AND (t.operation_no = s.operation_no))))
        ), running AS (
         SELECT p.tsnumber,
            p.confirmationnumber,
            p.full_name,
            p.ssbr_id,
            p.order_no,
            p.operation_no,
            p.operation_text,
            p.hour_checkin,
            p.hour_checkout,
            p.longdate_checkin,
            p.longdate_checkout,
            p.part_name,
            p.planhours,
            p.plant,
            p.serialnumber,
            p.state_flag,
            p.std_foreman_hours,
            p.validation_date,
            p.workcentercode,
            p.workcenterdescription,
            p.duration,
            p.modified_at,
            p.activitytype,
            p.date_checkin,
            p.date_checkout,
            p.note,
            p.sow_planhours,
            p.sow_plan_seconds,
            p.elapsed_seconds,
            COALESCE(sum(p.elapsed_seconds) OVER (PARTITION BY p.order_no, p.operation_no ORDER BY
                CASE
                    WHEN (p.longdate_checkin IS NULL) THEN 1
                    ELSE 0
                END, p.longdate_checkin, p.tsnumber ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), (0)::numeric) AS used_seconds_before
           FROM productive p
        )
 SELECT r.tsnumber,
    r.confirmationnumber,
    r.full_name,
    r.ssbr_id,
    r.order_no,
    r.operation_no,
    r.operation_text,
    r.hour_checkin,
    r.hour_checkout,
    r.longdate_checkin,
    r.longdate_checkout,
    r.part_name,
    r.planhours,
    r.plant,
    r.serialnumber,
    r.state_flag,
    r.std_foreman_hours,
    r.validation_date,
    r.workcentercode,
    r.workcenterdescription,
    r.duration,
    r.modified_at,
    r.activitytype,
    r.date_checkin,
    r.date_checkout,
    r.note,
    r.sow_planhours,
    r.sow_plan_seconds,
    r.elapsed_seconds,
    r.used_seconds_before,
    GREATEST((r.sow_plan_seconds - r.used_seconds_before), (0)::numeric) AS remaining_seconds_before,
    LEAST(r.elapsed_seconds, GREATEST((r.sow_plan_seconds - r.used_seconds_before), (0)::numeric)) AS std_performance,
    round((LEAST(r.elapsed_seconds, GREATEST((r.sow_plan_seconds - r.used_seconds_before), (0)::numeric)) / (3600)::numeric), 6) AS std_performance_hours
   FROM running r;

CREATE VIEW public.vw_timesheet_std_performance2 AS
 WITH productive AS (
         SELECT t.tsnumber,
            t.confirmationnumber,
            t.full_name,
            t.ssbr_id,
            s.order_no,
            s.operation_no,
            t.operation_text,
            t.hour_checkin,
            t.hour_checkout,
            t.longdate_checkin,
            t.longdate_checkout,
            t.part_name,
            t.planhours,
            t.plant,
            t.serialnumber,
            t.state_flag,
            t.std_foreman_hours,
            t.validation_date,
            t.workcentercode,
            t.workcenterdescription,
            t.duration,
            t.modified_at,
            t.activitytype,
            t.date_checkin,
            t.date_checkout,
            t.note,
            s.planhours AS sow_planhours,
            (COALESCE(s.planhours, (0)::numeric) * (3600)::numeric) AS sow_plan_seconds,
                CASE
                    WHEN (t.tsnumber IS NULL) THEN (0)::numeric
                    ELSE GREATEST(EXTRACT(epoch FROM (COALESCE(t.longdate_checkout, t.longdate_checkin) - t.longdate_checkin)), (0)::numeric)
                END AS elapsed_seconds
           FROM (public.sow s
             LEFT JOIN public.timesheet_transaction t ON (((t.order_no = s.order_no) AND (t.operation_no = s.operation_no))))
        ), running AS (
         SELECT p.tsnumber,
            p.confirmationnumber,
            p.full_name,
            p.ssbr_id,
            p.order_no,
            p.operation_no,
            p.operation_text,
            p.hour_checkin,
            p.hour_checkout,
            p.longdate_checkin,
            p.longdate_checkout,
            p.part_name,
            p.planhours,
            p.plant,
            p.serialnumber,
            p.state_flag,
            p.std_foreman_hours,
            p.validation_date,
            p.workcentercode,
            p.workcenterdescription,
            p.duration,
            p.modified_at,
            p.activitytype,
            p.date_checkin,
            p.date_checkout,
            p.note,
            p.sow_planhours,
            p.sow_plan_seconds,
            p.elapsed_seconds,
            COALESCE(sum(p.elapsed_seconds) OVER (PARTITION BY p.order_no, p.operation_no ORDER BY
                CASE
                    WHEN (p.longdate_checkin IS NULL) THEN 1
                    ELSE 0
                END, p.longdate_checkin, p.tsnumber ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), (0)::numeric) AS used_seconds_before
           FROM productive p
        )
 SELECT r.tsnumber,
    r.confirmationnumber,
    r.full_name,
    r.ssbr_id,
    r.order_no,
    r.operation_no,
    r.operation_text,
    r.hour_checkin,
    r.hour_checkout,
    r.longdate_checkin,
    r.longdate_checkout,
    r.part_name,
    r.planhours,
    r.plant,
    r.serialnumber,
    r.state_flag,
    r.std_foreman_hours,
    r.validation_date,
    r.workcentercode,
    r.workcenterdescription,
    r.duration,
    r.modified_at,
    r.activitytype,
    r.date_checkin,
    r.date_checkout,
    r.note,
    r.sow_planhours,
    r.sow_plan_seconds,
    r.elapsed_seconds,
    r.used_seconds_before,
    GREATEST((r.sow_plan_seconds - r.used_seconds_before), (0)::numeric) AS remaining_seconds_before,
    LEAST(r.elapsed_seconds, GREATEST((r.sow_plan_seconds - r.used_seconds_before), (0)::numeric)) AS std_performance,
    round((LEAST(r.elapsed_seconds, GREATEST((r.sow_plan_seconds - r.used_seconds_before), (0)::numeric)) / (3600)::numeric), 6) AS std_performance_hours
   FROM running r;

ALTER TABLE public.workcenter ALTER COLUMN idrow ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.workcenter_idrow_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE rbac.user_permissions (
    user_id integer NOT NULL,
    feature_id text NOT NULL,
    level text NOT NULL,
    updated_by integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_permissions_level_check CHECK ((level = ANY (ARRAY['no_access'::text, 'read_only'::text, 'full_access'::text])))
);

CREATE TABLE tools_management.handover_logs (
    handover_id bigint NOT NULL,
    handover_no character varying(80) NOT NULL,
    transaction_id bigint,
    tool_id bigint NOT NULL,
    from_field_snssb text,
    from_office_user_id integer,
    from_snapshot_name text,
    from_snapshot_workcenter text,
    to_field_snssb text,
    to_office_user_id integer,
    to_snapshot_name text,
    to_snapshot_workcenter text,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    handed_over_at timestamp with time zone,
    received_at timestamp with time zone,
    processed_by_office_user_id integer,
    processed_by_field_snssb text,
    condition_id smallint,
    quantity numeric(12,2) DEFAULT 1 NOT NULL,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT handover_from_required CHECK (((from_field_snssb IS NOT NULL) OR (from_office_user_id IS NOT NULL))),
    CONSTRAINT handover_not_same_field_user CHECK (((from_field_snssb IS NULL) OR (to_field_snssb IS NULL) OR (from_field_snssb <> to_field_snssb))),
    CONSTRAINT handover_not_same_office_user CHECK (((from_office_user_id IS NULL) OR (to_office_user_id IS NULL) OR (from_office_user_id <> to_office_user_id))),
    CONSTRAINT handover_quantity_positive CHECK ((quantity > (0)::numeric)),
    CONSTRAINT handover_received_after_request CHECK (((received_at IS NULL) OR (received_at >= requested_at))),
    CONSTRAINT handover_single_from CHECK (((from_field_snssb IS NULL) OR (from_office_user_id IS NULL))),
    CONSTRAINT handover_single_to CHECK (((to_field_snssb IS NULL) OR (to_office_user_id IS NULL))),
    CONSTRAINT handover_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('handed_over'::character varying)::text, ('accepted'::character varying)::text, ('rejected'::character varying)::text, ('cancelled'::character varying)::text]))),
    CONSTRAINT handover_to_required CHECK (((to_field_snssb IS NOT NULL) OR (to_office_user_id IS NOT NULL)))
);

CREATE SEQUENCE tools_management.handover_logs_handover_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tools_management.handover_logs_handover_id_seq OWNED BY tools_management.handover_logs.handover_id;

CREATE TABLE tools_management.reservations (
    reservation_id bigint NOT NULL,
    reservation_no character varying(80) NOT NULL,
    tool_id bigint NOT NULL,
    requester_field_snssb text,
    requester_office_user_id integer,
    requester_snapshot_name text,
    requester_snapshot_workcenter text,
    requester_snapshot_role text,
    quantity numeric(12,2) DEFAULT 1 NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    reserved_from timestamp with time zone NOT NULL,
    reserved_until timestamp with time zone NOT NULL,
    approved_by_office_user_id integer,
    approved_at timestamp with time zone,
    fulfilled_transaction_id bigint,
    purpose text,
    notes text,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reservations_quantity_positive CHECK ((quantity > (0)::numeric)),
    CONSTRAINT reservations_requester_required CHECK (((requester_field_snssb IS NOT NULL) OR (requester_office_user_id IS NOT NULL))),
    CONSTRAINT reservations_single_requester CHECK (((requester_field_snssb IS NULL) OR (requester_office_user_id IS NULL))),
    CONSTRAINT reservations_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('cancelled'::character varying)::text, ('expired'::character varying)::text, ('fulfilled'::character varying)::text]))),
    CONSTRAINT reservations_time_valid CHECK ((reserved_until > reserved_from))
);

CREATE SEQUENCE tools_management.reservations_reservation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tools_management.reservations_reservation_id_seq OWNED BY tools_management.reservations.reservation_id;

CREATE TABLE tools_management.tool_categories (
    category_id bigint NOT NULL,
    category_code character varying(50) NOT NULL,
    category_name character varying(100) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE tools_management.tool_categories_category_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tools_management.tool_categories_category_id_seq OWNED BY tools_management.tool_categories.category_id;

CREATE TABLE tools_management.tool_conditions (
    condition_id smallint NOT NULL,
    condition_code character varying(50) NOT NULL,
    condition_name character varying(100) NOT NULL,
    is_usable boolean DEFAULT true NOT NULL,
    sort_order smallint DEFAULT 100 NOT NULL
);

CREATE SEQUENCE tools_management.tool_conditions_condition_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tools_management.tool_conditions_condition_id_seq OWNED BY tools_management.tool_conditions.condition_id;

CREATE TABLE tools_management.tool_status_logs (
    status_log_id bigint NOT NULL,
    tool_id bigint NOT NULL,
    reservation_id bigint,
    transaction_id bigint,
    handover_id bigint,
    event_type character varying(40) NOT NULL,
    event_at timestamp with time zone DEFAULT now() NOT NULL,
    condition_id smallint,
    availability_status character varying(30),
    from_field_snssb text,
    from_office_user_id integer,
    to_field_snssb text,
    to_office_user_id integer,
    created_by_field_snssb text,
    created_by_office_user_id integer,
    actor_snapshot_name text,
    quantity_delta numeric(12,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tool_status_logs_availability_check CHECK (((availability_status IS NULL) OR ((availability_status)::text = ANY (ARRAY[('available'::character varying)::text, ('reserved'::character varying)::text, ('borrowed'::character varying)::text, ('handover_pending'::character varying)::text, ('maintenance'::character varying)::text, ('calibration'::character varying)::text, ('broken'::character varying)::text, ('lost'::character varying)::text, ('retired'::character varying)::text])))),
    CONSTRAINT tool_status_logs_event_type_check CHECK (((event_type)::text = ANY (ARRAY[('created'::character varying)::text, ('reserved'::character varying)::text, ('reservation_approved'::character varying)::text, ('reservation_rejected'::character varying)::text, ('reservation_cancelled'::character varying)::text, ('reservation_expired'::character varying)::text, ('borrowed'::character varying)::text, ('returned'::character varying)::text, ('handover_requested'::character varying)::text, ('handover_accepted'::character varying)::text, ('handover_rejected'::character varying)::text, ('condition_changed'::character varying)::text, ('maintenance_started'::character varying)::text, ('maintenance_finished'::character varying)::text, ('calibration_started'::character varying)::text, ('calibration_finished'::character varying)::text, ('lost'::character varying)::text, ('retired'::character varying)::text, ('stock_adjusted'::character varying)::text])))
);

CREATE SEQUENCE tools_management.tool_status_logs_status_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tools_management.tool_status_logs_status_log_id_seq OWNED BY tools_management.tool_status_logs.status_log_id;

CREATE TABLE tools_management.tools (
    tool_id bigint NOT NULL,
    asset_tag character varying(100) NOT NULL,
    tool_code character varying(100),
    source_file character varying(100),
    source_row_number integer,
    source_id character varying(50),
    category_id bigint NOT NULL,
    tool_name character varying(255) NOT NULL,
    tool_type character varying(100),
    classification character varying(100),
    measurement_range character varying(100),
    size_label character varying(100),
    specification text,
    notes text,
    is_serialized boolean DEFAULT true NOT NULL,
    quantity_total numeric(12,2) DEFAULT 1 NOT NULL,
    quantity_available numeric(12,2) DEFAULT 1 NOT NULL,
    unit character varying(30) DEFAULT 'pcs'::character varying NOT NULL,
    condition_id smallint,
    availability_status character varying(30) DEFAULT 'available'::character varying NOT NULL,
    responsible_field_snssb text,
    responsible_office_user_id integer,
    responsible_snapshot_name text,
    purchased_at date,
    last_calibration_at date,
    next_calibration_at date,
    retired_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tools_availability_status_check CHECK (((availability_status)::text = ANY (ARRAY[('available'::character varying)::text, ('reserved'::character varying)::text, ('borrowed'::character varying)::text, ('handover_pending'::character varying)::text, ('maintenance'::character varying)::text, ('calibration'::character varying)::text, ('broken'::character varying)::text, ('lost'::character varying)::text, ('retired'::character varying)::text]))),
    CONSTRAINT tools_quantity_available_valid CHECK (((quantity_available >= (0)::numeric) AND (quantity_available <= quantity_total))),
    CONSTRAINT tools_quantity_total_non_negative CHECK ((quantity_total >= (0)::numeric)),
    CONSTRAINT tools_serialized_quantity_check CHECK (((is_serialized = false) OR (quantity_total = (1)::numeric))),
    CONSTRAINT tools_single_responsible_party CHECK (((responsible_field_snssb IS NULL) OR (responsible_office_user_id IS NULL)))
);

CREATE SEQUENCE tools_management.tools_tool_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tools_management.tools_tool_id_seq OWNED BY tools_management.tools.tool_id;

CREATE TABLE tools_management.transactions (
    transaction_id bigint NOT NULL,
    transaction_no character varying(80) NOT NULL,
    reservation_id bigint,
    tool_id bigint NOT NULL,
    borrower_field_snssb text,
    borrower_office_user_id integer,
    borrower_snapshot_name text,
    borrower_snapshot_workcenter text,
    borrower_snapshot_role text,
    issued_by_office_user_id integer,
    issued_by_field_snssb text,
    returned_to_office_user_id integer,
    returned_to_field_snssb text,
    quantity numeric(12,2) DEFAULT 1 NOT NULL,
    borrowed_at timestamp with time zone DEFAULT now() NOT NULL,
    expected_return_at timestamp with time zone,
    returned_at timestamp with time zone,
    checkout_condition_id smallint,
    return_condition_id smallint,
    purpose text,
    checkout_notes text,
    return_notes text,
    status character varying(30) DEFAULT 'borrowed'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transactions_borrower_required CHECK (((borrower_field_snssb IS NOT NULL) OR (borrower_office_user_id IS NOT NULL))),
    CONSTRAINT transactions_quantity_positive CHECK ((quantity > (0)::numeric)),
    CONSTRAINT transactions_return_after_borrow CHECK (((returned_at IS NULL) OR (returned_at >= borrowed_at))),
    CONSTRAINT transactions_single_borrower CHECK (((borrower_field_snssb IS NULL) OR (borrower_office_user_id IS NULL))),
    CONSTRAINT transactions_status_check CHECK (((status)::text = ANY (ARRAY[('borrowed'::character varying)::text, ('returned'::character varying)::text, ('overdue'::character varying)::text, ('lost'::character varying)::text, ('cancelled'::character varying)::text])))
);

CREATE SEQUENCE tools_management.transactions_transaction_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE tools_management.transactions_transaction_id_seq OWNED BY tools_management.transactions.transaction_id;

CREATE VIEW tools_management.v_handover_logs_with_users AS
 SELECT h.handover_id,
    h.handover_no,
    h.transaction_id,
    h.tool_id,
    h.from_field_snssb,
    h.from_office_user_id,
    h.from_snapshot_name,
    h.from_snapshot_workcenter,
    h.to_field_snssb,
    h.to_office_user_id,
    h.to_snapshot_name,
    h.to_snapshot_workcenter,
    h.requested_at,
    h.handed_over_at,
    h.received_at,
    h.processed_by_office_user_id,
    h.processed_by_field_snssb,
    h.condition_id,
    h.quantity,
    h.status,
    h.notes,
    h.created_at,
    h.updated_at,
    t.asset_tag,
    t.tool_code,
    t.tool_name,
    from_field.full_name AS from_field_name,
    from_field.nfcid AS from_field_nfcid,
    from_field.workcenter AS from_field_workcenter,
    from_office.username AS from_office_username,
    from_office.name AS from_office_name,
    to_field.full_name AS to_field_name,
    to_field.nfcid AS to_field_nfcid,
    to_field.workcenter AS to_field_workcenter,
    to_office.username AS to_office_username,
    to_office.name AS to_office_name
   FROM (((((tools_management.handover_logs h
     JOIN tools_management.tools t ON ((t.tool_id = h.tool_id)))
     LEFT JOIN public.usernfc from_field ON ((from_field.snssb = h.from_field_snssb)))
     LEFT JOIN public.users from_office ON ((from_office.id = h.from_office_user_id)))
     LEFT JOIN public.usernfc to_field ON ((to_field.snssb = h.to_field_snssb)))
     LEFT JOIN public.users to_office ON ((to_office.id = h.to_office_user_id)));

CREATE VIEW tools_management.v_reservations_with_users AS
 SELECT r.reservation_id,
    r.reservation_no,
    r.tool_id,
    r.requester_field_snssb,
    r.requester_office_user_id,
    r.requester_snapshot_name,
    r.requester_snapshot_workcenter,
    r.requester_snapshot_role,
    r.quantity,
    r.requested_at,
    r.reserved_from,
    r.reserved_until,
    r.approved_by_office_user_id,
    r.approved_at,
    r.fulfilled_transaction_id,
    r.purpose,
    r.notes,
    r.status,
    r.created_at,
    r.updated_at,
    t.asset_tag,
    t.tool_code,
    t.tool_name,
    fn.full_name AS requester_field_name,
    fn.nfcid AS requester_field_nfcid,
    fn.workcenter AS requester_field_workcenter,
    fn.roles AS requester_field_role,
    ou.username AS requester_office_username,
    ou.name AS requester_office_name,
    approver.username AS approved_by_username,
    approver.name AS approved_by_name
   FROM ((((tools_management.reservations r
     JOIN tools_management.tools t ON ((t.tool_id = r.tool_id)))
     LEFT JOIN public.usernfc fn ON ((fn.snssb = r.requester_field_snssb)))
     LEFT JOIN public.users ou ON ((ou.id = r.requester_office_user_id)))
     LEFT JOIN public.users approver ON ((approver.id = r.approved_by_office_user_id)));

CREATE VIEW tools_management.v_tools_with_responsible_user AS
 SELECT t.tool_id,
    t.asset_tag,
    t.tool_code,
    t.source_file,
    t.source_row_number,
    t.source_id,
    t.category_id,
    t.tool_name,
    t.tool_type,
    t.classification,
    t.measurement_range,
    t.size_label,
    t.specification,
    t.notes,
    t.is_serialized,
    t.quantity_total,
    t.quantity_available,
    t.unit,
    t.condition_id,
    t.availability_status,
    t.responsible_field_snssb,
    t.responsible_office_user_id,
    t.responsible_snapshot_name,
    t.purchased_at,
    t.last_calibration_at,
    t.next_calibration_at,
    t.retired_at,
    t.created_at,
    t.updated_at,
    fn.full_name AS responsible_field_name,
    fn.nfcid AS responsible_field_nfcid,
    fn.workcenter AS responsible_field_workcenter,
    fn.roles AS responsible_field_role,
    ou.username AS responsible_office_username,
    ou.name AS responsible_office_name,
    ou.role AS responsible_office_role
   FROM ((tools_management.tools t
     LEFT JOIN public.usernfc fn ON ((fn.snssb = t.responsible_field_snssb)))
     LEFT JOIN public.users ou ON ((ou.id = t.responsible_office_user_id)));

CREATE VIEW tools_management.v_transactions_with_users AS
 SELECT tr.transaction_id,
    tr.transaction_no,
    tr.reservation_id,
    tr.tool_id,
    tr.borrower_field_snssb,
    tr.borrower_office_user_id,
    tr.borrower_snapshot_name,
    tr.borrower_snapshot_workcenter,
    tr.borrower_snapshot_role,
    tr.issued_by_office_user_id,
    tr.issued_by_field_snssb,
    tr.returned_to_office_user_id,
    tr.returned_to_field_snssb,
    tr.quantity,
    tr.borrowed_at,
    tr.expected_return_at,
    tr.returned_at,
    tr.checkout_condition_id,
    tr.return_condition_id,
    tr.purpose,
    tr.checkout_notes,
    tr.return_notes,
    tr.status,
    tr.created_at,
    tr.updated_at,
    t.asset_tag,
    t.tool_code,
    t.tool_name,
    fn.full_name AS borrower_field_name,
    fn.nfcid AS borrower_field_nfcid,
    fn.workcenter AS borrower_field_workcenter,
    fn.roles AS borrower_field_role,
    ou.username AS borrower_office_username,
    ou.name AS borrower_office_name
   FROM (((tools_management.transactions tr
     JOIN tools_management.tools t ON ((t.tool_id = tr.tool_id)))
     LEFT JOIN public.usernfc fn ON ((fn.snssb = tr.borrower_field_snssb)))
     LEFT JOIN public.users ou ON ((ou.id = tr.borrower_office_user_id)));

ALTER TABLE ONLY ews.action_history ALTER COLUMN id SET DEFAULT nextval('ews.action_history_id_seq'::regclass);

ALTER TABLE ONLY ews.action_table ALTER COLUMN action_id SET DEFAULT nextval('ews.action_table_action_id_seq'::regclass);

ALTER TABLE ONLY ews.adoption_summary_snapshot ALTER COLUMN id SET DEFAULT nextval('ews.adoption_summary_snapshot_id_seq'::regclass);

ALTER TABLE ONLY ews.alert_log ALTER COLUMN id SET DEFAULT nextval('ews.alert_log_id_seq'::regclass);

ALTER TABLE ONLY ews.issue_log ALTER COLUMN id SET DEFAULT nextval('ews.issue_log_id_seq'::regclass);

ALTER TABLE ONLY ews.kpi_snapshot ALTER COLUMN id SET DEFAULT nextval('ews.kpi_snapshot_id_seq'::regclass);

ALTER TABLE ONLY public.buffer_transaction ALTER COLUMN id SET DEFAULT nextval('public.buffer_transaction_id_seq'::regclass);

ALTER TABLE ONLY public.component_hours ALTER COLUMN id SET DEFAULT nextval('public.component_hours_id_seq'::regclass);

ALTER TABLE ONLY public.mch_machine_ping_log ALTER COLUMN id SET DEFAULT nextval('public.mch_machine_ping_log_id_seq'::regclass);

ALTER TABLE ONLY public.progress_update_history ALTER COLUMN id SET DEFAULT nextval('public.progress_update_history_id_seq'::regclass);

ALTER TABLE ONLY public.sow_nnva_base ALTER COLUMN id SET DEFAULT nextval('public.sow_nnva_base_id_seq'::regclass);

ALTER TABLE ONLY public.sow_nnva_standard ALTER COLUMN id SET DEFAULT nextval('public.sow_nnva_standard_id_seq'::regclass);

ALTER TABLE ONLY public.sow_operation_status ALTER COLUMN id SET DEFAULT nextval('public.sow_operation_status_id_seq'::regclass);

ALTER TABLE ONLY public.sow_revision_history ALTER COLUMN id SET DEFAULT nextval('public.sow_revision_history_id_seq'::regclass);

ALTER TABLE ONLY public.sow_standard_attachments ALTER COLUMN id SET DEFAULT nextval('public.sow_standard_attachments_id_seq'::regclass);

ALTER TABLE ONLY public.sow_sub_operation ALTER COLUMN id SET DEFAULT nextval('public.sow_sub_operation_id_seq'::regclass);

ALTER TABLE ONLY public.sow_sub_operation_progress_history ALTER COLUMN id SET DEFAULT nextval('public.sow_sub_operation_progress_history_id_seq'::regclass);

ALTER TABLE ONLY public.sow_verification_log ALTER COLUMN id SET DEFAULT nextval('public.sow_verification_log_id_seq'::regclass);

ALTER TABLE ONLY public.tts_notifications ALTER COLUMN id SET DEFAULT nextval('public.tts_notifications_id_seq'::regclass);

ALTER TABLE ONLY tools_management.handover_logs ALTER COLUMN handover_id SET DEFAULT nextval('tools_management.handover_logs_handover_id_seq'::regclass);

ALTER TABLE ONLY tools_management.reservations ALTER COLUMN reservation_id SET DEFAULT nextval('tools_management.reservations_reservation_id_seq'::regclass);

ALTER TABLE ONLY tools_management.tool_categories ALTER COLUMN category_id SET DEFAULT nextval('tools_management.tool_categories_category_id_seq'::regclass);

ALTER TABLE ONLY tools_management.tool_conditions ALTER COLUMN condition_id SET DEFAULT nextval('tools_management.tool_conditions_condition_id_seq'::regclass);

ALTER TABLE ONLY tools_management.tool_status_logs ALTER COLUMN status_log_id SET DEFAULT nextval('tools_management.tool_status_logs_status_log_id_seq'::regclass);

ALTER TABLE ONLY tools_management.tools ALTER COLUMN tool_id SET DEFAULT nextval('tools_management.tools_tool_id_seq'::regclass);

ALTER TABLE ONLY tools_management.transactions ALTER COLUMN transaction_id SET DEFAULT nextval('tools_management.transactions_transaction_id_seq'::regclass);

ALTER TABLE ONLY ews.action_history
    ADD CONSTRAINT action_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ews.action_table
    ADD CONSTRAINT action_table_pkey PRIMARY KEY (action_id);

ALTER TABLE ONLY ews.activity_type_ref
    ADD CONSTRAINT activity_type_ref_pkey PRIMARY KEY (activitytype);

ALTER TABLE ONLY ews.adoption_bucket_snapshot
    ADD CONSTRAINT adoption_bucket_snapshot_pkey PRIMARY KEY (bucket_start, machine_key, operator_key);

ALTER TABLE ONLY ews.adoption_summary_snapshot
    ADD CONSTRAINT adoption_summary_snapshot_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ews.adoption_summary_snapshot
    ADD CONSTRAINT adoption_summary_snapshot_window_grain_source_key UNIQUE (window_start, window_end, grain, adoption_source);

ALTER TABLE ONLY ews.alert_log
    ADD CONSTRAINT alert_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ews.device_heartbeat_daily
    ADD CONSTRAINT device_heartbeat_daily_pkey PRIMARY KEY (work_date, device_id);

ALTER TABLE ONLY ews.issue_log
    ADD CONSTRAINT issue_log_issue_key_key UNIQUE (issue_key);

ALTER TABLE ONLY ews.issue_log
    ADD CONSTRAINT issue_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ews.kpi_snapshot
    ADD CONSTRAINT kpi_snapshot_date_key UNIQUE (window_start, grain, scope_type, scope_key, shift_id);

ALTER TABLE ONLY ews.kpi_snapshot
    ADD CONSTRAINT kpi_snapshot_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ews.kpi_threshold
    ADD CONSTRAINT kpi_threshold_pkey PRIMARY KEY (kpi_type);

ALTER TABLE ONLY ews.machine_heartbeat_daily
    ADD CONSTRAINT machine_heartbeat_daily_pkey PRIMARY KEY (work_date, machineno);

ALTER TABLE ONLY ews.operator_rotation_group
    ADD CONSTRAINT operator_rotation_group_pkey PRIMARY KEY (serialnumber);

ALTER TABLE ONLY ews.operator_shift_lock
    ADD CONSTRAINT operator_shift_lock_no_overlap EXCLUDE USING gist (serialnumber WITH =, daterange(effective_from, lock_end, '[)'::text) WITH &&) WHERE ((cancelled_at IS NULL));

ALTER TABLE ONLY ews.operator_shift_lock
    ADD CONSTRAINT operator_shift_lock_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ews.operator_shift
    ADD CONSTRAINT operator_shift_pkey PRIMARY KEY (shift_code);

ALTER TABLE ONLY ews.roster_workday_rule
    ADD CONSTRAINT roster_workday_rule_pkey PRIMARY KEY (day_of_week);

ALTER TABLE ONLY ews.rotation_config
    ADD CONSTRAINT rotation_config_pkey PRIMARY KEY (id);

ALTER TABLE ONLY ews.shift_roster
    ADD CONSTRAINT shift_roster_pkey PRIMARY KEY (serialnumber, business_date);

ALTER TABLE ONLY ews.tts_notification
    ADD CONSTRAINT tts_notification_issue_key_key UNIQUE (issue_key);

ALTER TABLE ONLY ews.tts_notification
    ADD CONSTRAINT tts_notification_pkey PRIMARY KEY (id);

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
    ADD CONSTRAINT consumable_stock_material_code_key UNIQUE (material_code);

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

ALTER TABLE ONLY public.device_status
    ADD CONSTRAINT device_status_pkey PRIMARY KEY (device_id);

ALTER TABLE ONLY public.log_timesheet_sap
    ADD CONSTRAINT log_timesheet_sap_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mch_machine_ping_log
    ADD CONSTRAINT mch_machine_ping_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mch_machines
    ADD CONSTRAINT mch_machines_pkey PRIMARY KEY (machineno);

ALTER TABLE ONLY public.mch_statustypes
    ADD CONSTRAINT mch_statustypes_pkey PRIMARY KEY (statusid);

ALTER TABLE ONLY public.mch_transaction_override
    ADD CONSTRAINT mch_transaction_override_pkey PRIMARY KEY (proddataid);

ALTER TABLE ONLY public.mch_transaction
    ADD CONSTRAINT mch_transaction_pkey PRIMARY KEY (proddataid);

ALTER TABLE ONLY public.ms_project_assignment
    ADD CONSTRAINT ms_project_assignment_pkey PRIMARY KEY (assignment_id);

ALTER TABLE ONLY public.ms_project_assignment
    ADD CONSTRAINT ms_project_assignment_project_id_assignment_id_key UNIQUE (project_id, assignment_id);

ALTER TABLE ONLY public.ms_project_audit_log
    ADD CONSTRAINT ms_project_audit_log_pkey PRIMARY KEY (audit_id);

ALTER TABLE ONLY public.ms_project_bay_schedule
    ADD CONSTRAINT ms_project_bay_schedule_pkey PRIMARY KEY (schedule_id);

ALTER TABLE ONLY public.ms_project_calendar
    ADD CONSTRAINT ms_project_calendar_calendar_code_key UNIQUE (calendar_code);

ALTER TABLE ONLY public.ms_project_calendar_exception
    ADD CONSTRAINT ms_project_calendar_exception_pkey PRIMARY KEY (exception_id);

ALTER TABLE ONLY public.ms_project_calendar_exception_time
    ADD CONSTRAINT ms_project_calendar_exception_time_exception_id_segment_no_key UNIQUE (exception_id, segment_no);

ALTER TABLE ONLY public.ms_project_calendar_exception_time
    ADD CONSTRAINT ms_project_calendar_exception_time_pkey PRIMARY KEY (exception_time_id);

ALTER TABLE ONLY public.ms_project_calendar
    ADD CONSTRAINT ms_project_calendar_pkey PRIMARY KEY (calendar_id);

ALTER TABLE ONLY public.ms_project_calendar_weekday
    ADD CONSTRAINT ms_project_calendar_weekday_calendar_id_day_of_week_key UNIQUE (calendar_id, day_of_week);

ALTER TABLE ONLY public.ms_project_calendar_weekday
    ADD CONSTRAINT ms_project_calendar_weekday_pkey PRIMARY KEY (calendar_weekday_id);

ALTER TABLE ONLY public.ms_project_calendar_working_time
    ADD CONSTRAINT ms_project_calendar_working_t_calendar_id_day_of_week_segme_key UNIQUE (calendar_id, day_of_week, segment_no);

ALTER TABLE ONLY public.ms_project_calendar_working_time
    ADD CONSTRAINT ms_project_calendar_working_time_pkey PRIMARY KEY (working_time_id);

ALTER TABLE ONLY public.ms_project_dependency
    ADD CONSTRAINT ms_project_dependency_pkey PRIMARY KEY (dependency_id);

ALTER TABLE ONLY public.ms_project_dependency
    ADD CONSTRAINT ms_project_dependency_project_id_dependency_id_key UNIQUE (project_id, dependency_id);

ALTER TABLE ONLY public.ms_project_lock
    ADD CONSTRAINT ms_project_lock_lock_token_key UNIQUE (lock_token);

ALTER TABLE ONLY public.ms_project_lock
    ADD CONSTRAINT ms_project_lock_pkey PRIMARY KEY (lock_id);

ALTER TABLE ONLY public.ms_project_lock
    ADD CONSTRAINT ms_project_lock_project_id_key UNIQUE (project_id);

ALTER TABLE ONLY public.ms_project
    ADD CONSTRAINT ms_project_pkey PRIMARY KEY (project_id);

ALTER TABLE ONLY public.ms_project_publish
    ADD CONSTRAINT ms_project_publish_pkey PRIMARY KEY (publish_id);

ALTER TABLE ONLY public.ms_project_publish
    ADD CONSTRAINT ms_project_publish_project_id_revision_no_key UNIQUE (project_id, revision_no);

ALTER TABLE ONLY public.ms_project_resource_availability
    ADD CONSTRAINT ms_project_resource_availability_pkey PRIMARY KEY (availability_id);

ALTER TABLE ONLY public.ms_project_resource
    ADD CONSTRAINT ms_project_resource_pkey PRIMARY KEY (project_resource_id);

ALTER TABLE ONLY public.ms_project_resource
    ADD CONSTRAINT ms_project_resource_project_id_resource_id_key UNIQUE (project_id, resource_id);

ALTER TABLE ONLY public.ms_project_revision
    ADD CONSTRAINT ms_project_revision_pkey PRIMARY KEY (revision_id);

ALTER TABLE ONLY public.ms_project_task
    ADD CONSTRAINT ms_project_task_pkey PRIMARY KEY (task_id);

ALTER TABLE ONLY public.ms_project_task
    ADD CONSTRAINT ms_project_task_project_id_task_id_key UNIQUE (project_id, task_id);

ALTER TABLE ONLY public.ms_resource
    ADD CONSTRAINT ms_resource_pkey PRIMARY KEY (resource_id);

ALTER TABLE ONLY public.ms_resource
    ADD CONSTRAINT ms_resource_resource_code_key UNIQUE (resource_code);

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

ALTER TABLE ONLY public.plant_config
    ADD CONSTRAINT plant_config_pkey PRIMARY KEY (id);

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

ALTER TABLE ONLY public.sap_ops_request
    ADD CONSTRAINT sap_ops_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sap_source_change_blocked
    ADD CONSTRAINT sap_source_change_blocked_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sap_stage_cursor
    ADD CONSTRAINT sap_stage_cursor_pkey PRIMARY KEY (source_system, plant);

ALTER TABLE ONLY public.sap_staging_eligibility_audit
    ADD CONSTRAINT sap_staging_eligibility_audit_pkey PRIMARY KEY (source_system, source_key);

ALTER TABLE ONLY public.sap_staging_source
    ADD CONSTRAINT sap_staging_source_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sap_timesheet_staging
    ADD CONSTRAINT sap_timesheet_staging_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sap_timesheet_staging
    ADD CONSTRAINT sap_timesheet_staging_source_uk UNIQUE (source_system, source_key);

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (filename);

ALTER TABLE ONLY public.shift_definition
    ADD CONSTRAINT shift_definition_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_receiving_order_id_key UNIQUE (receiving_order_id);

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_codenumber_uniq UNIQUE (codenumber);

ALTER TABLE ONLY public.sow_documentno
    ADD CONSTRAINT sow_documentno_documentno_key UNIQUE (documentno);

ALTER TABLE ONLY public.sow_documentno
    ADD CONSTRAINT sow_documentno_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_machine_capacity
    ADD CONSTRAINT sow_machine_capacity_machine_code_schedule_date_shift_id_key UNIQUE (machine_code, schedule_date, shift_id);

ALTER TABLE ONLY public.sow_machine_capacity
    ADD CONSTRAINT sow_machine_capacity_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_nnva_base
    ADD CONSTRAINT sow_nnva_base_name_key UNIQUE (name);

ALTER TABLE ONLY public.sow_nnva_base
    ADD CONSTRAINT sow_nnva_base_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_sow_standard_id_nnva_base_id_key UNIQUE (sow_standard_id, nnva_base_id);

ALTER TABLE ONLY public.sow_operation_status
    ADD CONSTRAINT sow_operation_status_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_operation_status
    ADD CONSTRAINT sow_operation_status_uq UNIQUE (production_order, operation_no, machine_code, status_date);

ALTER TABLE ONLY public.sow_operationcard
    ADD CONSTRAINT sow_operationcard_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_overtime_request
    ADD CONSTRAINT sow_overtime_request_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow
    ADD CONSTRAINT sow_pkey PRIMARY KEY (idsow);

ALTER TABLE ONLY public.sow_revision_history
    ADD CONSTRAINT sow_revision_history_order_no_revision_no_key UNIQUE (order_no, revision_no);

ALTER TABLE ONLY public.sow_revision_history
    ADD CONSTRAINT sow_revision_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_schedule_batch
    ADD CONSTRAINT sow_schedule_batch_batch_code_key UNIQUE (batch_code);

ALTER TABLE ONLY public.sow_schedule_batch
    ADD CONSTRAINT sow_schedule_batch_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_schedule
    ADD CONSTRAINT sow_schedule_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_sub_operation
    ADD CONSTRAINT sow_sub_operation_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_sub_operation_progress_history
    ADD CONSTRAINT sow_sub_operation_progress_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_subcont_mark
    ADD CONSTRAINT sow_subcont_mark_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_pkey PRIMARY KEY (template_id);

ALTER TABLE ONLY public.sow_verification_log
    ADD CONSTRAINT sow_verification_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.timesheet_transaction
    ADD CONSTRAINT timesheet_transaction_pkey PRIMARY KEY (tsnumber);

ALTER TABLE ONLY public.tts_notification_order
    ADD CONSTRAINT tts_notification_order_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tts_notifications
    ADD CONSTRAINT tts_notifications_order_no_key UNIQUE (order_no);

ALTER TABLE ONLY public.tts_notifications
    ADD CONSTRAINT tts_notifications_pkey PRIMARY KEY (id);

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

ALTER TABLE ONLY rbac.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id, feature_id);

ALTER TABLE ONLY tools_management.handover_logs
    ADD CONSTRAINT handover_logs_handover_no_key UNIQUE (handover_no);

ALTER TABLE ONLY tools_management.handover_logs
    ADD CONSTRAINT handover_logs_pkey PRIMARY KEY (handover_id);

ALTER TABLE ONLY tools_management.reservations
    ADD CONSTRAINT reservations_pkey PRIMARY KEY (reservation_id);

ALTER TABLE ONLY tools_management.reservations
    ADD CONSTRAINT reservations_reservation_no_key UNIQUE (reservation_no);

ALTER TABLE ONLY tools_management.tool_categories
    ADD CONSTRAINT tool_categories_category_code_key UNIQUE (category_code);

ALTER TABLE ONLY tools_management.tool_categories
    ADD CONSTRAINT tool_categories_pkey PRIMARY KEY (category_id);

ALTER TABLE ONLY tools_management.tool_conditions
    ADD CONSTRAINT tool_conditions_condition_code_key UNIQUE (condition_code);

ALTER TABLE ONLY tools_management.tool_conditions
    ADD CONSTRAINT tool_conditions_pkey PRIMARY KEY (condition_id);

ALTER TABLE ONLY tools_management.tool_status_logs
    ADD CONSTRAINT tool_status_logs_pkey PRIMARY KEY (status_log_id);

ALTER TABLE ONLY tools_management.tools
    ADD CONSTRAINT tools_asset_tag_key UNIQUE (asset_tag);

ALTER TABLE ONLY tools_management.tools
    ADD CONSTRAINT tools_pkey PRIMARY KEY (tool_id);

ALTER TABLE ONLY tools_management.tools
    ADD CONSTRAINT tools_source_row_unique UNIQUE (source_file, source_row_number);

ALTER TABLE ONLY tools_management.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (transaction_id);

ALTER TABLE ONLY tools_management.transactions
    ADD CONSTRAINT transactions_transaction_no_key UNIQUE (transaction_no);

CREATE INDEX idx_device_hb_daily_device ON ews.device_heartbeat_daily USING btree (device_id, work_date DESC);

CREATE INDEX idx_ews_action_escalation ON ews.action_table USING btree (severity, action_status, action_date DESC);

CREATE UNIQUE INDEX idx_ews_action_issue_key ON ews.action_table USING btree (issue_key) WHERE (issue_key IS NOT NULL);

CREATE INDEX idx_ews_action_kpi_status ON ews.action_table USING btree (kpi_type, action_status, action_date DESC);

CREATE INDEX idx_ews_action_status ON ews.action_table USING btree (action_status, due_at, last_updated DESC);

CREATE INDEX idx_ews_adoption_bucket_gap ON ews.adoption_bucket_snapshot USING btree (gap_type, bucket_start DESC) WHERE (gap_type IS NOT NULL);

CREATE INDEX idx_ews_adoption_bucket_latest ON ews.adoption_bucket_snapshot USING btree (bucket_start DESC, machine_key, operator_key);

CREATE INDEX idx_ews_adoption_summary_latest ON ews.adoption_summary_snapshot USING btree (grain, window_end DESC, calculated_at DESC);

CREATE INDEX idx_ews_adoption_summary_source_latest ON ews.adoption_summary_snapshot USING btree (grain, adoption_source, window_end DESC, calculated_at DESC);

CREATE INDEX idx_ews_alert_open ON ews.alert_log USING btree (alert_status, severity, alert_timestamp DESC);

CREATE INDEX idx_ews_alert_scope ON ews.alert_log USING btree (scope_type, scope_key, kpi_type, alert_timestamp DESC);

CREATE INDEX idx_ews_issue_log_category_status ON ews.issue_log USING btree (category, status, business_date DESC);

CREATE INDEX idx_ews_issue_log_created ON ews.issue_log USING btree (created_at DESC);

CREATE INDEX idx_ews_kpi_snapshot_latest ON ews.kpi_snapshot USING btree (grain, scope_type, scope_key, window_end DESC);

CREATE INDEX idx_ews_kpi_snapshot_status ON ews.kpi_snapshot USING btree (overall_status, window_end DESC);

CREATE INDEX idx_ews_shift_roster_date ON ews.shift_roster USING btree (business_date);

CREATE INDEX idx_ews_shift_roster_status ON ews.shift_roster USING btree (business_date, status);

CREATE INDEX idx_ews_tts_ready_unplayed ON ews.tts_notification USING btree (played, generated_at DESC) WHERE (generation_status = 'ready'::text);

CREATE INDEX idx_ews_tts_status_created ON ews.tts_notification USING btree (generation_status, created_at);

CREATE INDEX idx_machine_heartbeat_daily_machineno ON ews.machine_heartbeat_daily USING btree (machineno);

CREATE INDEX idx_buffer_transaction_box_priority ON public.buffer_transaction USING btree (machine_id, type, priority, created_at DESC);

CREATE INDEX idx_buffer_transaction_component ON public.buffer_transaction USING btree (component_id);

CREATE INDEX idx_buffer_transaction_history ON public.buffer_transaction USING btree (order_no, operation_no, created_at DESC);

CREATE INDEX idx_buffer_transaction_latest ON public.buffer_transaction USING btree (machine_id, order_no, operation_no, created_at DESC, id DESC);

CREATE INDEX idx_buffer_transaction_machine_time ON public.buffer_transaction USING btree (machine_id, "timestamp" DESC);

CREATE INDEX idx_buffer_transaction_machine_type_time ON public.buffer_transaction USING btree (machine_id, type, "timestamp" DESC);

CREATE INDEX idx_buffer_transaction_order_key_operation_time ON public.buffer_transaction USING btree (ltrim(COALESCE(order_no, ''::text), '0'::text), operation_no, "timestamp" DESC);

CREATE INDEX idx_buffer_transaction_order_operation ON public.buffer_transaction USING btree (machine_id, order_no, operation_no, created_at DESC);

CREATE INDEX idx_buffer_transaction_order_type_time ON public.buffer_transaction USING btree (order_no, type, "timestamp" DESC);

CREATE INDEX idx_buffer_transaction_shipment_latest ON public.buffer_transaction USING btree (type, order_no, created_at DESC, id DESC) WHERE (type = 'shipment'::text);

CREATE INDEX idx_component_hours_machine ON public.component_hours USING btree (machine_id, total_hours DESC);

CREATE INDEX idx_consumable_item_cis_no ON public.consumable_item USING btree (cis_no);

CREATE INDEX idx_consumable_item_status ON public.consumable_item USING btree (status);

CREATE INDEX idx_consumable_stock_code_mm ON public.consumable_stock USING btree (code_mm);

CREATE INDEX idx_consumable_stock_description_trgm ON public.consumable_stock USING gin (material_description public.gin_trgm_ops);

CREATE INDEX idx_consumable_stock_material_code ON public.consumable_stock USING btree (material_code);

CREATE INDEX idx_consumable_ticket_sn_created ON public.consumable_ticket USING btree (sn_karyawan, created DESC);

CREATE INDEX idx_customers_name ON public.customers USING btree (name);

CREATE INDEX idx_customers_site ON public.customers USING btree (site_name);

CREATE INDEX idx_mch_machine_ping_log_checked_at ON public.mch_machine_ping_log USING btree (checked_at DESC);

CREATE INDEX idx_mch_machine_ping_log_ipaddress ON public.mch_machine_ping_log USING btree (ipaddress);

CREATE INDEX idx_mch_machine_ping_log_machineid ON public.mch_machine_ping_log USING btree (machineid);

CREATE INDEX idx_mch_productiondata_machine_start ON public.mch_productiondata USING btree (machineno, startdatetime);

CREATE INDEX idx_mch_productiondata_startdatetime ON public.mch_productiondata USING btree (startdatetime);

CREATE INDEX idx_mch_transaction_machine_time ON public.mch_transaction USING btree (machineno, startdatetime, proddataid);

CREATE INDEX idx_mch_transaction_sap_eligible ON public.mch_transaction USING btree (startdatetime) WHERE ((enddatetime IS NOT NULL) AND (NULLIF(btrim(sn_employee), ''::text) IS NOT NULL));

CREATE INDEX idx_mch_transaction_sap_window ON public.mch_transaction USING btree (startdatetime, enddatetime) WHERE ((confirmation_number IS NOT NULL) AND ((confirmation_number)::text <> ''::text) AND (order_no IS NOT NULL) AND ((order_no)::text <> ''::text) AND (operation_no IS NOT NULL) AND ((operation_no)::text <> ''::text));

CREATE INDEX idx_mch_transaction_status_record_false ON public.mch_transaction USING btree (machineno) WHERE (status_record = false);

CREATE INDEX idx_mch_transaction_stuck ON public.mch_transaction USING btree (startdatetime) WHERE is_stuck;

CREATE INDEX idx_ms_project_assignment_project ON public.ms_project_assignment USING btree (project_id, is_active);

CREATE INDEX idx_ms_project_assignment_resource_window ON public.ms_project_assignment USING btree (resource_id, assignment_start, assignment_finish) WHERE (is_active = true);

CREATE INDEX idx_ms_project_audit_action_created ON public.ms_project_audit_log USING btree (action, created_at DESC);

CREATE INDEX idx_ms_project_audit_project_created ON public.ms_project_audit_log USING btree (project_id, created_at DESC);

CREATE INDEX idx_ms_project_bay_schedule_bays ON public.ms_project_bay_schedule USING gin (bay_codes) WHERE (status = ANY (ARRAY['RESERVED'::text, 'CONFIRMED'::text]));

CREATE INDEX idx_ms_project_bay_schedule_group ON public.ms_project_bay_schedule USING btree (schedule_group_id);

CREATE INDEX idx_ms_project_bay_schedule_order ON public.ms_project_bay_schedule USING btree (order_no, start_date DESC);

CREATE INDEX idx_ms_project_bay_schedule_window ON public.ms_project_bay_schedule USING btree (start_date, end_date) WHERE (status = ANY (ARRAY['RESERVED'::text, 'CONFIRMED'::text]));

CREATE INDEX idx_ms_project_calendar_active_scope ON public.ms_project_calendar USING btree (is_active, calendar_scope);

CREATE INDEX idx_ms_project_calendar_exception_calendar_dates ON public.ms_project_calendar_exception USING btree (calendar_id, start_date, end_date) WHERE (is_active = true);

CREATE INDEX idx_ms_project_calendar_id ON public.ms_project USING btree (calendar_id);

CREATE INDEX idx_ms_project_calendar_working_time_calendar_day ON public.ms_project_calendar_working_time USING btree (calendar_id, day_of_week);

CREATE INDEX idx_ms_project_dependency_project ON public.ms_project_dependency USING btree (project_id, is_active);

CREATE INDEX idx_ms_project_lock_expiry ON public.ms_project_lock USING btree (expires_at);

CREATE INDEX idx_ms_project_publish_project_published ON public.ms_project_publish USING btree (project_id, published_at DESC);

CREATE INDEX idx_ms_project_resource_availability_resource_window ON public.ms_project_resource_availability USING btree (resource_id, available_from, available_to);

CREATE INDEX idx_ms_project_resource_project ON public.ms_project_resource USING btree (project_id, is_active);

CREATE INDEX idx_ms_project_revision_project_created ON public.ms_project_revision USING btree (project_id, created_at DESC);

CREATE INDEX idx_ms_project_status_updated ON public.ms_project USING btree (status, updated_at DESC);

CREATE INDEX idx_ms_project_task_business ON public.ms_project_task USING btree (project_id, order_no, operation_no);

CREATE INDEX idx_ms_project_task_calendar_id ON public.ms_project_task USING btree (calendar_id);

CREATE INDEX idx_ms_project_task_project ON public.ms_project_task USING btree (project_id, is_active);

CREATE INDEX idx_ms_project_task_window ON public.ms_project_task USING btree (plan_start, plan_finish);

CREATE INDEX idx_ms_resource_calendar_id ON public.ms_resource USING btree (calendar_id);

CREATE INDEX idx_ms_resource_search ON public.ms_resource USING btree (resource_category, is_active, resource_code);

CREATE INDEX idx_ms_resource_workcenter ON public.ms_resource USING btree (workcenter_code) WHERE (workcenter_code IS NOT NULL);

CREATE INDEX idx_mv_mch_productiondata_detail_machine_date ON public.mv_mch_productiondata_detail USING btree (machineno, work_date DESC);

CREATE INDEX idx_mv_mch_productiondata_detail_order_operation ON public.mv_mch_productiondata_detail USING btree (order_no, operation_no);

CREATE INDEX idx_mv_mch_productiondata_detail_status ON public.mv_mch_productiondata_detail USING btree (statusid);

CREATE INDEX idx_mv_mch_productiondata_detail_timesheet ON public.mv_mch_productiondata_detail USING btree (tsnumber);

CREATE INDEX idx_mv_mch_productiondata_detail_work_date ON public.mv_mch_productiondata_detail USING btree (work_date DESC);

CREATE UNIQUE INDEX idx_mv_oad_order_op ON public.mv_order_activity_detail USING btree (order_no, operation_no);

CREATE UNIQUE INDEX idx_mv_opa_order_no ON public.mv_order_plan_vs_actual USING btree (order_no);

CREATE UNIQUE INDEX idx_mv_roh_order_no ON public.mv_order_remaining_hours USING btree (order_no);

CREATE INDEX idx_nnva_std_nnva_id ON public.sow_nnva_standard USING btree (nnva_base_id);

CREATE INDEX idx_nnva_std_sow_id ON public.sow_nnva_standard USING btree (sow_standard_id);

CREATE INDEX idx_opcard_std_id ON public.sow_operationcard USING btree (sow_standard_id);

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

CREATE INDEX idx_ph3_confirmation_id ON public.ph3_order USING btree (confirmation_number, id DESC);

CREATE INDEX idx_ph3_order_confirmation_number ON public.ph3_order USING btree (confirmation_number);

CREATE INDEX idx_ph3_order_order_description ON public.ph3_order USING btree (order_no, order_description);

CREATE INDEX idx_ph3_order_order_key ON public.ph3_order USING btree (ltrim((COALESCE(order_no, ''::character varying))::text, '0'::text));

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

CREATE INDEX idx_sap_ops_request_status ON public.sap_ops_request USING btree (status, id);

CREATE INDEX idx_sap_source_change_blocked_row ON public.sap_source_change_blocked USING btree (source_system, source_row_id, blocked_at DESC);

CREATE INDEX idx_sap_staging_is_correction ON public.sap_timesheet_staging USING btree (is_correction, status, bucket_start);

CREATE INDEX idx_sap_staging_productive_status ON public.sap_timesheet_staging USING btree (is_productive, status);

CREATE INDEX idx_sap_staging_source_segment ON public.sap_staging_source USING btree (source_system, source_row_id, bucket_start);

CREATE INDEX idx_shift_definition_effective_date_active ON public.shift_definition USING btree (effective_date, is_active);

CREATE INDEX idx_sow_codenumber ON public.sow USING btree (codenumber);

CREATE INDEX idx_sow_machine_capacity_lookup ON public.sow_machine_capacity USING btree (schedule_date, shift_id, machine_code) WHERE (is_active = true);

CREATE INDEX idx_sow_model ON public.sow USING btree (model);

CREATE INDEX idx_sow_operation_status_date ON public.sow_operation_status USING btree (status_date);

CREATE INDEX idx_sow_operation_status_flag ON public.sow_operation_status USING btree (manual_flag);

CREATE INDEX idx_sow_operation_status_order ON public.sow_operation_status USING btree (production_order);

CREATE INDEX idx_sow_operationcard_order_operation_revision ON public.sow_operationcard USING btree (order_no, operation_no, revision_no);

CREATE UNIQUE INDEX idx_sow_operationcard_standard_revision ON public.sow_operationcard USING btree (sow_standard_id, revision_no);

CREATE INDEX idx_sow_order_key_operation_idsow ON public.sow USING btree (ltrim(COALESCE(order_no, ''::text), '0'::text), operation_no, idsow DESC);

CREATE INDEX idx_sow_order_no ON public.sow USING btree (order_no);

CREATE INDEX idx_sow_order_operation_progress ON public.sow USING btree (order_no, operation_no, progress);

CREATE INDEX idx_sow_overtime_sow ON public.sow_overtime_request USING btree (sow_id, production_order, operation_no);

CREATE INDEX idx_sow_overtime_status ON public.sow_overtime_request USING btree (request_status, overtime_date, shift_id, machine_code);

CREATE INDEX idx_sow_part_number ON public.sow USING btree (part_number);

CREATE INDEX idx_sow_revision_history_order_created ON public.sow_revision_history USING btree (order_no, created_at DESC);

CREATE INDEX idx_sow_schedule_batch_id ON public.sow_schedule USING btree (batch_id) WHERE (batch_id IS NOT NULL);

CREATE INDEX idx_sow_schedule_date ON public.sow_schedule USING btree (schedule_date);

CREATE INDEX idx_sow_schedule_machine_shift ON public.sow_schedule USING btree (machine_code, schedule_date, shift_id, schedule_status);

CREATE INDEX idx_sow_schedule_sow ON public.sow_schedule USING btree (sow_id, production_order, operation_no);

CREATE INDEX idx_sow_schedule_window ON public.sow_schedule USING btree (planned_start_datetime, planned_end_datetime);

CREATE INDEX idx_sow_source_op_id ON public.sow USING btree (source_op_id);

CREATE INDEX idx_sow_ssbr_id ON public.sow USING btree (ssbr_id);

CREATE INDEX idx_sow_standard_component_id ON public.sow_standard USING btree (component_id);

CREATE INDEX idx_sow_standard_source_plant ON public.sow_standard USING btree (source_plant);

CREATE INDEX idx_sow_std_attach_standard_id ON public.sow_standard_attachments USING btree (standard_id);

CREATE INDEX idx_sow_sub_op_prog_hist_created ON public.sow_sub_operation_progress_history USING btree (created_at DESC);

CREATE INDEX idx_sow_sub_op_prog_hist_sub ON public.sow_sub_operation_progress_history USING btree (sub_operation_id);

CREATE INDEX idx_sow_sub_operation_operation ON public.sow_sub_operation USING btree (operation_id);

CREATE INDEX idx_sow_sub_operation_order ON public.sow_sub_operation USING btree (order_no);

CREATE INDEX idx_sow_subcont_mark_order ON public.sow_subcont_mark USING btree (ltrim(order_no, '0'::text)) WHERE (unmarked_at IS NULL);

CREATE INDEX idx_sow_sync_modified ON public.sow USING btree (order_no, operation_no) WHERE (sync = 'modified'::text);

CREATE INDEX idx_sow_templates_component_active ON public.sow_templates USING btree (component_id, is_active, sort_order, template_name);

CREATE INDEX idx_sow_tmpl_lines_standard_id ON public.sow_template_lines USING btree (standard_id);

CREATE INDEX idx_sow_tmpl_lines_template_id ON public.sow_template_lines USING btree (template_id);

CREATE INDEX idx_sow_verification_log_date ON public.sow_verification_log USING btree (verification_date);

CREATE INDEX idx_sow_verification_log_order ON public.sow_verification_log USING btree (production_order);

CREATE INDEX idx_sow_workcenter ON public.sow USING btree (workcenter);

CREATE INDEX idx_sr_delivery_date ON public.shipping_records USING btree (delivery_date);

CREATE INDEX idx_sr_order ON public.shipping_records USING btree (receiving_order_id);

CREATE INDEX idx_sr_send_by ON public.shipping_records USING btree (send_by_id);

CREATE INDEX idx_src_etl_plant ON public.ph3_order USING btree (plant_code, status_etl);

CREATE INDEX idx_timesheet_lookup ON public.timesheet_transaction USING btree (order_no, operation_no, longdate_checkin);

CREATE INDEX idx_timesheet_modified ON public.timesheet_transaction USING btree (modified_at);

CREATE INDEX idx_timesheet_transaction_order_active ON public.timesheet_transaction USING btree (order_no, longdate_checkout, longdate_checkin);

CREATE INDEX idx_timesheet_transaction_order_key_checkout ON public.timesheet_transaction USING btree (ltrim(COALESCE(order_no, ''::text), '0'::text), longdate_checkout DESC) WHERE (longdate_checkout IS NOT NULL);

CREATE INDEX idx_timesheet_transaction_order_key_operation_checkin ON public.timesheet_transaction USING btree (ltrim(COALESCE(order_no, ''::text), '0'::text), operation_no, longdate_checkin DESC);

CREATE INDEX idx_timesheet_transaction_order_operation_checkin ON public.timesheet_transaction USING btree (order_no, operation_no, longdate_checkin);

CREATE INDEX idx_timesheet_transaction_workcenter_active ON public.timesheet_transaction USING btree (workcentercode, longdate_checkout, longdate_checkin DESC);

CREATE INDEX idx_ts_component_tracking_active ON public.timesheet_transaction USING btree (workcentercode, longdate_checkout, longdate_checkin DESC) WHERE (longdate_checkin IS NOT NULL);

CREATE INDEX idx_ts_component_tracking_productive ON public.timesheet_transaction USING btree (workcentercode, order_no, operation_no, longdate_checkin) WHERE ((activitytype IS NULL) AND (longdate_checkin IS NOT NULL));

CREATE INDEX idx_ts_longdate_checkin ON public.timesheet_transaction USING btree (longdate_checkin);

CREATE INDEX idx_ts_longdate_checkout ON public.timesheet_transaction USING btree (longdate_checkout);

CREATE INDEX idx_ts_operation_no ON public.timesheet_transaction USING btree (operation_no);

CREATE INDEX idx_ts_order_no ON public.timesheet_transaction USING btree (order_no);

CREATE INDEX idx_ts_order_no_trgm ON public.timesheet_transaction USING gin (order_no public.gin_trgm_ops);

CREATE INDEX idx_ts_order_wc ON public.timesheet_transaction USING btree (order_no, workcentercode);

CREATE INDEX idx_ts_serial_checkin ON public.timesheet_transaction USING btree (serialnumber, longdate_checkin);

CREATE INDEX idx_ts_serialnumber ON public.timesheet_transaction USING btree (serialnumber);

CREATE INDEX idx_ts_state_flag ON public.timesheet_transaction USING btree (state_flag);

CREATE INDEX idx_ts_validation_date ON public.timesheet_transaction USING btree (validation_date);

CREATE INDEX idx_ts_workcentercode ON public.timesheet_transaction USING btree (workcentercode);

CREATE INDEX idx_tts_notif_created ON public.tts_notifications USING btree (created_at DESC);

CREATE INDEX idx_tts_notif_status ON public.tts_notifications USING btree (status);

CREATE INDEX idx_tts_notification_order_generation_status_created ON public.tts_notification_order USING btree (generation_status, created_at);

CREATE INDEX idx_tts_notification_order_status_created ON public.tts_notification_order USING btree (status, created_at);

CREATE INDEX idx_users_role ON public.users USING btree (role);

CREATE INDEX idx_users_username ON public.users USING btree (username);

CREATE INDEX idx_workcenter_machineid ON public.workcenter USING btree (machineid);

CREATE INDEX idx_workcenter_workcenternew ON public.workcenter USING btree (workcenternew);

CREATE INDEX idx_workcenter_workcenterold ON public.workcenter USING btree (workcenterold);

CREATE INDEX idx_workcenter_workcenterot ON public.workcenter USING btree (workcenterot);

CREATE INDEX ix_ts_ms_bay_schedule ON public.timesheet_transaction USING btree (ms_bay_schedule_id) WHERE (ms_bay_schedule_id IS NOT NULL);

CREATE INDEX ix_usernfc_inactive_from ON public.usernfc USING btree (inactive_from) WHERE (inactive_from IS NOT NULL);

CREATE INDEX sap_staging_eligibility_audit_date_idx ON public.sap_staging_eligibility_audit USING btree (source_system, source_date, eligibility_status);

CREATE INDEX sap_timesheet_staging_bucket_idx ON public.sap_timesheet_staging USING btree (source_system, bucket_start);

CREATE INDEX sap_timesheet_staging_source_idx ON public.sap_timesheet_staging USING btree (source_system, source_ref_id);

CREATE INDEX sap_timesheet_staging_status_idx ON public.sap_timesheet_staging USING btree (status, created_at);

CREATE UNIQUE INDEX uq_mch_productiondata_proddataid ON public.mch_productiondata USING btree (proddataid);

CREATE UNIQUE INDEX uq_mch_user_operatorid ON public.mch_user USING btree (operatorid);

CREATE UNIQUE INDEX uq_mch_user_sn_employee ON public.mch_user USING btree (sn_employee);

CREATE UNIQUE INDEX uq_ms_project_assignment_local_uid ON public.ms_project_assignment USING btree (project_id, local_assignment_uid) WHERE (local_assignment_uid IS NOT NULL);

CREATE UNIQUE INDEX uq_ms_project_calendar_code_ci ON public.ms_project_calendar USING btree (lower(calendar_code));

CREATE UNIQUE INDEX uq_ms_project_calendar_guid ON public.ms_project_calendar USING btree (calendar_guid) WHERE (calendar_guid IS NOT NULL);

CREATE UNIQUE INDEX uq_ms_project_calendar_source ON public.ms_project_calendar USING btree (source_type, source_ref_id) WHERE (source_ref_id IS NOT NULL);

CREATE UNIQUE INDEX uq_ms_project_dependency_active_pair ON public.ms_project_dependency USING btree (project_id, predecessor_task_id, successor_task_id, COALESCE(dependency_type, 'FS'::text), COALESCE(lag_minutes, 0)) WHERE (is_active = true);

CREATE UNIQUE INDEX uq_ms_project_dependency_local_key ON public.ms_project_dependency USING btree (project_id, local_dependency_key) WHERE (local_dependency_key IS NOT NULL);

CREATE UNIQUE INDEX uq_ms_project_resource_availability_source ON public.ms_project_resource_availability USING btree (resource_id, source_type, source_ref_id) WHERE (source_ref_id IS NOT NULL);

CREATE UNIQUE INDEX uq_ms_project_revision_project_no_type ON public.ms_project_revision USING btree (project_id, revision_no, revision_type);

CREATE UNIQUE INDEX uq_ms_project_task_local_uid ON public.ms_project_task USING btree (project_id, local_task_uid) WHERE (local_task_uid IS NOT NULL);

CREATE UNIQUE INDEX uq_ms_resource_source ON public.ms_resource USING btree (source_type, source_ref_id) WHERE (source_ref_id IS NOT NULL);

CREATE UNIQUE INDEX uq_mv_kanban_order_board_order_key ON public.mv_kanban_order_board USING btree (order_key);

CREATE UNIQUE INDEX uq_mv_mch_productiondata_detail_proddataid ON public.mv_mch_productiondata_detail USING btree (proddataid);

CREATE UNIQUE INDEX uq_sap_ops_request_active ON public.sap_ops_request USING btree (action) WHERE (status = ANY (ARRAY['QUEUED'::text, 'RUNNING'::text]));

CREATE UNIQUE INDEX uq_sap_staging_source_posted_once ON public.sap_staging_source USING btree (source_system, source_row_id, bucket_start) WHERE (posted_at IS NOT NULL);

CREATE UNIQUE INDEX uq_sap_staging_source_segment_per_bundle ON public.sap_staging_source USING btree (staging_id, source_system, source_row_id, bucket_start);

CREATE UNIQUE INDEX uq_shift_definition_default_code ON public.shift_definition USING btree (lower(shift_code)) WHERE (is_default = true);

CREATE UNIQUE INDEX uq_shift_definition_effective_date_code ON public.shift_definition USING btree (lower(shift_code), effective_date) WHERE ((is_default = false) AND (effective_date IS NOT NULL));

CREATE UNIQUE INDEX uq_sow_documentno_default ON public.sow_documentno USING btree ("default") WHERE ("default" = true);

CREATE UNIQUE INDEX uq_sow_standard_component_operation ON public.sow_standard USING btree (component_id, operation_no);

CREATE UNIQUE INDEX uq_sow_subcont_mark_active ON public.sow_subcont_mark USING btree (ltrim(order_no, '0'::text), operation_no) WHERE (unmarked_at IS NULL);

CREATE UNIQUE INDEX uq_sow_template_lines_template_standard ON public.sow_template_lines USING btree (template_id, standard_id);

CREATE UNIQUE INDEX uq_sow_templates_component_key ON public.sow_templates USING btree (component_id, template_key);

CREATE UNIQUE INDEX uq_usernfc_nfcid ON public.usernfc USING btree (nfcid);

CREATE INDEX idx_rbac_user_permissions_user ON rbac.user_permissions USING btree (user_id);

CREATE INDEX idx_handover_logs_from_field_snssb ON tools_management.handover_logs USING btree (from_field_snssb);

CREATE INDEX idx_handover_logs_from_office_user_id ON tools_management.handover_logs USING btree (from_office_user_id);

CREATE INDEX idx_handover_logs_requested_at ON tools_management.handover_logs USING btree (requested_at);

CREATE INDEX idx_handover_logs_status ON tools_management.handover_logs USING btree (status);

CREATE INDEX idx_handover_logs_to_field_snssb ON tools_management.handover_logs USING btree (to_field_snssb);

CREATE INDEX idx_handover_logs_to_office_user_id ON tools_management.handover_logs USING btree (to_office_user_id);

CREATE INDEX idx_handover_logs_tool_id ON tools_management.handover_logs USING btree (tool_id);

CREATE INDEX idx_handover_logs_transaction_id ON tools_management.handover_logs USING btree (transaction_id);

CREATE INDEX idx_reservations_field_snssb ON tools_management.reservations USING btree (requester_field_snssb);

CREATE INDEX idx_reservations_office_user_id ON tools_management.reservations USING btree (requester_office_user_id);

CREATE INDEX idx_reservations_requested_at ON tools_management.reservations USING btree (requested_at DESC);

CREATE INDEX idx_reservations_reserved_window ON tools_management.reservations USING btree (tool_id, reserved_from, reserved_until);

CREATE INDEX idx_reservations_status ON tools_management.reservations USING btree (status);

CREATE INDEX idx_reservations_tool_id ON tools_management.reservations USING btree (tool_id);

CREATE INDEX idx_tool_status_logs_created_by_field_snssb ON tools_management.tool_status_logs USING btree (created_by_field_snssb);

CREATE INDEX idx_tool_status_logs_created_by_office_user_id ON tools_management.tool_status_logs USING btree (created_by_office_user_id);

CREATE INDEX idx_tool_status_logs_event_type ON tools_management.tool_status_logs USING btree (event_type);

CREATE INDEX idx_tool_status_logs_handover_id ON tools_management.tool_status_logs USING btree (handover_id);

CREATE INDEX idx_tool_status_logs_reservation_id ON tools_management.tool_status_logs USING btree (reservation_id);

CREATE INDEX idx_tool_status_logs_tool_id_event_at ON tools_management.tool_status_logs USING btree (tool_id, event_at DESC);

CREATE INDEX idx_tool_status_logs_transaction_id ON tools_management.tool_status_logs USING btree (transaction_id);

CREATE INDEX idx_tools_availability_status ON tools_management.tools USING btree (availability_status);

CREATE INDEX idx_tools_category_id ON tools_management.tools USING btree (category_id);

CREATE INDEX idx_tools_condition_id ON tools_management.tools USING btree (condition_id);

CREATE INDEX idx_tools_responsible_field_snssb ON tools_management.tools USING btree (responsible_field_snssb);

CREATE INDEX idx_tools_responsible_office_user_id ON tools_management.tools USING btree (responsible_office_user_id);

CREATE INDEX idx_tools_tool_code ON tools_management.tools USING btree (tool_code);

CREATE INDEX idx_tools_tool_name ON tools_management.tools USING btree (tool_name);

CREATE INDEX idx_transactions_borrowed_at ON tools_management.transactions USING btree (borrowed_at);

CREATE INDEX idx_transactions_borrower_field_snssb ON tools_management.transactions USING btree (borrower_field_snssb);

CREATE INDEX idx_transactions_borrower_office_user_id ON tools_management.transactions USING btree (borrower_office_user_id);

CREATE INDEX idx_transactions_expected_return_at ON tools_management.transactions USING btree (expected_return_at);

CREATE INDEX idx_transactions_open_by_tool ON tools_management.transactions USING btree (tool_id, status) WHERE ((status)::text = ANY (ARRAY[('borrowed'::character varying)::text, ('overdue'::character varying)::text]));

CREATE INDEX idx_transactions_reservation_id ON tools_management.transactions USING btree (reservation_id);

CREATE INDEX idx_transactions_status ON tools_management.transactions USING btree (status);

CREATE INDEX idx_transactions_tool_id ON tools_management.transactions USING btree (tool_id);

CREATE TRIGGER trg_mch_transaction_freeze_posted BEFORE UPDATE ON public.mch_transaction FOR EACH ROW EXECUTE FUNCTION public.mch_transaction_freeze_posted();

CREATE TRIGGER trg_mch_transaction_invalidate_pending AFTER UPDATE ON public.mch_transaction FOR EACH ROW EXECUTE FUNCTION public.mch_transaction_invalidate_pending_bundles();

CREATE TRIGGER trg_ms_project_bay_schedule_updated_at BEFORE UPDATE ON public.ms_project_bay_schedule FOR EACH ROW EXECUTE FUNCTION public.set_ms_project_updated_at();

CREATE TRIGGER trg_ms_project_calendar_exception_time_updated_at BEFORE UPDATE ON public.ms_project_calendar_exception_time FOR EACH ROW EXECUTE FUNCTION public.set_ms_project_updated_at();

CREATE TRIGGER trg_ms_project_calendar_exception_updated_at BEFORE UPDATE ON public.ms_project_calendar_exception FOR EACH ROW EXECUTE FUNCTION public.set_ms_project_updated_at();

CREATE TRIGGER trg_ms_project_calendar_updated_at BEFORE UPDATE ON public.ms_project_calendar FOR EACH ROW EXECUTE FUNCTION public.set_ms_project_updated_at();

CREATE TRIGGER trg_ms_project_calendar_weekday_updated_at BEFORE UPDATE ON public.ms_project_calendar_weekday FOR EACH ROW EXECUTE FUNCTION public.set_ms_project_updated_at();

CREATE TRIGGER trg_ms_project_calendar_working_time_updated_at BEFORE UPDATE ON public.ms_project_calendar_working_time FOR EACH ROW EXECUTE FUNCTION public.set_ms_project_updated_at();

CREATE TRIGGER trg_ms_project_lock_updated_at BEFORE UPDATE ON public.ms_project_lock FOR EACH ROW EXECUTE FUNCTION public.set_ms_project_updated_at();

CREATE TRIGGER trg_ms_project_resource_availability_updated_at BEFORE UPDATE ON public.ms_project_resource_availability FOR EACH ROW EXECUTE FUNCTION public.set_ms_project_updated_at();

CREATE TRIGGER trg_sap_staging_mark_segments_posted AFTER UPDATE OF status ON public.sap_timesheet_staging FOR EACH ROW EXECUTE FUNCTION public.sap_staging_mark_segments_posted();

CREATE TRIGGER trg_handover_logs_updated_at BEFORE UPDATE ON tools_management.handover_logs FOR EACH ROW EXECUTE FUNCTION tools_management.set_updated_at();

CREATE TRIGGER trg_reservations_updated_at BEFORE UPDATE ON tools_management.reservations FOR EACH ROW EXECUTE FUNCTION tools_management.set_updated_at();

CREATE TRIGGER trg_tool_categories_updated_at BEFORE UPDATE ON tools_management.tool_categories FOR EACH ROW EXECUTE FUNCTION tools_management.set_updated_at();

CREATE TRIGGER trg_tools_updated_at BEFORE UPDATE ON tools_management.tools FOR EACH ROW EXECUTE FUNCTION tools_management.set_updated_at();

CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON tools_management.transactions FOR EACH ROW EXECUTE FUNCTION tools_management.set_updated_at();

ALTER TABLE ONLY ews.action_history
    ADD CONSTRAINT action_history_action_id_fkey FOREIGN KEY (action_id) REFERENCES ews.action_table(action_id);

ALTER TABLE ONLY ews.action_table
    ADD CONSTRAINT action_table_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES ews.alert_log(id);

ALTER TABLE ONLY ews.operator_shift_lock
    ADD CONSTRAINT operator_shift_lock_locked_shift_fkey FOREIGN KEY (locked_shift) REFERENCES ews.operator_shift(shift_code);

ALTER TABLE ONLY ews.shift_roster
    ADD CONSTRAINT shift_roster_scheduled_shift_fkey FOREIGN KEY (scheduled_shift) REFERENCES ews.operator_shift(shift_code);

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

ALTER TABLE ONLY public.ms_project_assignment
    ADD CONSTRAINT fk_ms_project_assignment_project_resource FOREIGN KEY (project_id, resource_id) REFERENCES public.ms_project_resource(project_id, resource_id);

ALTER TABLE ONLY public.ms_project_assignment
    ADD CONSTRAINT fk_ms_project_assignment_task_same_project FOREIGN KEY (project_id, task_id) REFERENCES public.ms_project_task(project_id, task_id);

ALTER TABLE ONLY public.ms_project_bay_schedule
    ADD CONSTRAINT fk_ms_project_bay_schedule_task FOREIGN KEY (project_id, task_id) REFERENCES public.ms_project_task(project_id, task_id);

ALTER TABLE ONLY public.ms_project_dependency
    ADD CONSTRAINT fk_ms_project_dependency_pred_same_project FOREIGN KEY (project_id, predecessor_task_id) REFERENCES public.ms_project_task(project_id, task_id);

ALTER TABLE ONLY public.ms_project_dependency
    ADD CONSTRAINT fk_ms_project_dependency_succ_same_project FOREIGN KEY (project_id, successor_task_id) REFERENCES public.ms_project_task(project_id, task_id);

ALTER TABLE ONLY public.ms_project_task
    ADD CONSTRAINT fk_ms_project_task_parent_same_project FOREIGN KEY (project_id, parent_task_id) REFERENCES public.ms_project_task(project_id, task_id);

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

ALTER TABLE ONLY public.ms_project_assignment
    ADD CONSTRAINT ms_project_assignment_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id);

ALTER TABLE ONLY public.ms_project_assignment
    ADD CONSTRAINT ms_project_assignment_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.ms_resource(resource_id);

ALTER TABLE ONLY public.ms_project_audit_log
    ADD CONSTRAINT ms_project_audit_log_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ms_project_bay_schedule
    ADD CONSTRAINT ms_project_bay_schedule_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.ms_project_calendar
    ADD CONSTRAINT ms_project_calendar_base_calendar_id_fkey FOREIGN KEY (base_calendar_id) REFERENCES public.ms_project_calendar(calendar_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.ms_project_calendar_exception
    ADD CONSTRAINT ms_project_calendar_exception_calendar_id_fkey FOREIGN KEY (calendar_id) REFERENCES public.ms_project_calendar(calendar_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ms_project_calendar_exception_time
    ADD CONSTRAINT ms_project_calendar_exception_time_exception_id_fkey FOREIGN KEY (exception_id) REFERENCES public.ms_project_calendar_exception(exception_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ms_project
    ADD CONSTRAINT ms_project_calendar_id_fkey FOREIGN KEY (calendar_id) REFERENCES public.ms_project_calendar(calendar_id);

ALTER TABLE ONLY public.ms_project_calendar_weekday
    ADD CONSTRAINT ms_project_calendar_weekday_calendar_id_fkey FOREIGN KEY (calendar_id) REFERENCES public.ms_project_calendar(calendar_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ms_project_calendar_working_time
    ADD CONSTRAINT ms_project_calendar_working_time_calendar_id_fkey FOREIGN KEY (calendar_id) REFERENCES public.ms_project_calendar(calendar_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ms_project_dependency
    ADD CONSTRAINT ms_project_dependency_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id);

ALTER TABLE ONLY public.ms_project_lock
    ADD CONSTRAINT ms_project_lock_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ms_project_publish
    ADD CONSTRAINT ms_project_publish_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ms_project_resource_availability
    ADD CONSTRAINT ms_project_resource_availability_calendar_id_fkey FOREIGN KEY (calendar_id) REFERENCES public.ms_project_calendar(calendar_id);

ALTER TABLE ONLY public.ms_project_resource_availability
    ADD CONSTRAINT ms_project_resource_availability_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.ms_resource(resource_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ms_project_resource
    ADD CONSTRAINT ms_project_resource_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id);

ALTER TABLE ONLY public.ms_project_resource
    ADD CONSTRAINT ms_project_resource_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.ms_resource(resource_id);

ALTER TABLE ONLY public.ms_project_revision
    ADD CONSTRAINT ms_project_revision_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ms_project_task
    ADD CONSTRAINT ms_project_task_calendar_id_fkey FOREIGN KEY (calendar_id) REFERENCES public.ms_project_calendar(calendar_id);

ALTER TABLE ONLY public.ms_project_task
    ADD CONSTRAINT ms_project_task_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.ms_project(project_id);

ALTER TABLE ONLY public.ms_resource
    ADD CONSTRAINT ms_resource_calendar_id_fkey FOREIGN KEY (calendar_id) REFERENCES public.ms_project_calendar(calendar_id);

ALTER TABLE ONLY public.ms_resource
    ADD CONSTRAINT ms_resource_parent_resource_id_fkey FOREIGN KEY (parent_resource_id) REFERENCES public.ms_resource(resource_id);

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

ALTER TABLE ONLY public.sap_staging_source
    ADD CONSTRAINT sap_staging_source_staging_id_fkey FOREIGN KEY (staging_id) REFERENCES public.sap_timesheet_staging(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.shipping_records
    ADD CONSTRAINT shipping_records_receiving_order_id_fkey FOREIGN KEY (receiving_order_id) REFERENCES public.receiving_orders(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.sow_machine_capacity
    ADD CONSTRAINT sow_machine_capacity_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shift_definition(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_nnva_base_id_fkey FOREIGN KEY (nnva_base_id) REFERENCES public.sow_nnva_base(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.sow_nnva_standard
    ADD CONSTRAINT sow_nnva_standard_sow_standard_id_fkey FOREIGN KEY (sow_standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sow_overtime_request
    ADD CONSTRAINT sow_overtime_request_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shift_definition(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sow_overtime_request
    ADD CONSTRAINT sow_overtime_request_sow_id_fkey FOREIGN KEY (sow_id) REFERENCES public.sow(idsow) ON DELETE SET NULL;

ALTER TABLE ONLY public.sow_schedule
    ADD CONSTRAINT sow_schedule_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.sow_schedule_batch(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sow_schedule_batch
    ADD CONSTRAINT sow_schedule_batch_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shift_definition(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sow_schedule
    ADD CONSTRAINT sow_schedule_overtime_request_id_fkey FOREIGN KEY (overtime_request_id) REFERENCES public.sow_overtime_request(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sow_schedule
    ADD CONSTRAINT sow_schedule_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shift_definition(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.sow_schedule
    ADD CONSTRAINT sow_schedule_sow_id_fkey FOREIGN KEY (sow_id) REFERENCES public.sow(idsow) ON DELETE SET NULL;

ALTER TABLE ONLY public.sow_standard_attachments
    ADD CONSTRAINT sow_standard_attachments_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sow_standard
    ADD CONSTRAINT sow_standard_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);

ALTER TABLE ONLY public.sow_sub_operation
    ADD CONSTRAINT sow_sub_operation_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.sow(idsow) ON DELETE CASCADE;

ALTER TABLE ONLY public.sow_sub_operation_progress_history
    ADD CONSTRAINT sow_sub_operation_progress_history_sub_operation_id_fkey FOREIGN KEY (sub_operation_id) REFERENCES public.sow_sub_operation(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES public.sow_standard(id);

ALTER TABLE ONLY public.sow_template_lines
    ADD CONSTRAINT sow_template_lines_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.sow_templates(template_id);

ALTER TABLE ONLY public.sow_templates
    ADD CONSTRAINT sow_templates_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(component_id);

ALTER TABLE ONLY rbac.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY tools_management.handover_logs
    ADD CONSTRAINT handover_logs_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES tools_management.tool_conditions(condition_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tools_management.handover_logs
    ADD CONSTRAINT handover_logs_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES tools_management.tools(tool_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tools_management.handover_logs
    ADD CONSTRAINT handover_logs_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES tools_management.transactions(transaction_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY tools_management.reservations
    ADD CONSTRAINT reservations_fulfilled_transaction_fk FOREIGN KEY (fulfilled_transaction_id) REFERENCES tools_management.transactions(transaction_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY tools_management.reservations
    ADD CONSTRAINT reservations_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES tools_management.tools(tool_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tools_management.tool_status_logs
    ADD CONSTRAINT tool_status_logs_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES tools_management.tool_conditions(condition_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tools_management.tool_status_logs
    ADD CONSTRAINT tool_status_logs_handover_id_fkey FOREIGN KEY (handover_id) REFERENCES tools_management.handover_logs(handover_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY tools_management.tool_status_logs
    ADD CONSTRAINT tool_status_logs_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES tools_management.reservations(reservation_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY tools_management.tool_status_logs
    ADD CONSTRAINT tool_status_logs_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES tools_management.tools(tool_id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY tools_management.tool_status_logs
    ADD CONSTRAINT tool_status_logs_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES tools_management.transactions(transaction_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY tools_management.tools
    ADD CONSTRAINT tools_category_id_fkey FOREIGN KEY (category_id) REFERENCES tools_management.tool_categories(category_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tools_management.tools
    ADD CONSTRAINT tools_condition_id_fkey FOREIGN KEY (condition_id) REFERENCES tools_management.tool_conditions(condition_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tools_management.transactions
    ADD CONSTRAINT transactions_checkout_condition_id_fkey FOREIGN KEY (checkout_condition_id) REFERENCES tools_management.tool_conditions(condition_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tools_management.transactions
    ADD CONSTRAINT transactions_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES tools_management.reservations(reservation_id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ONLY tools_management.transactions
    ADD CONSTRAINT transactions_return_condition_id_fkey FOREIGN KEY (return_condition_id) REFERENCES tools_management.tool_conditions(condition_id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY tools_management.transactions
    ADD CONSTRAINT transactions_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES tools_management.tools(tool_id) ON UPDATE CASCADE ON DELETE RESTRICT;

