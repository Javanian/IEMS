
UPDATE public.plant_config
SET sap_rules = jsonb_build_object(
  'break_windows', jsonb_build_array(
    jsonb_build_object('start', '12:00', 'end', '13:00', 'days', jsonb_build_array(1, 2, 3, 4, 5, 6, 0)),
    jsonb_build_object('start', '00:00', 'end', '01:00', 'days', jsonb_build_array(1, 2, 3, 4, 5)),
    jsonb_build_object('start', '18:30', 'end', '19:00', 'days', jsonb_build_array(6, 0)),
    jsonb_build_object('start', '22:00', 'end', '22:30', 'days', jsonb_build_array(6, 0))
  ),
  'max_record_minutes', 90
),
updated_by = 'migration-20260819',
updated_at = now()
WHERE id = 1;

ALTER TABLE public.sap_ops_request
  DROP CONSTRAINT IF EXISTS sap_ops_request_action_ck,
  ADD CONSTRAINT sap_ops_request_action_ck CHECK (
    action IN ('stage_catchup', 'retry_failed', 'post_corrections', 'rebuild_pending')
  );

