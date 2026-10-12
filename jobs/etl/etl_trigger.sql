
DROP TRIGGER IF EXISTS trg_etl_notify ON mps_confirmation_header;

DROP FUNCTION IF EXISTS fn_etl_notify();

CREATE OR REPLACE FUNCTION fn_etl_notify()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('etl_new_row', NEW.plant_code);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_etl_notify
AFTER INSERT OR UPDATE ON ph3_order
FOR EACH ROW
WHEN (NEW.status_etl = 'NEW')
EXECUTE FUNCTION fn_etl_notify();

