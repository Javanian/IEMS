
ALTER TABLE public.sap_ops_request DROP CONSTRAINT IF EXISTS sap_ops_request_action_ck;
ALTER TABLE public.sap_ops_request
  ADD CONSTRAINT sap_ops_request_action_ck
  CHECK (action IN ('stage_catchup', 'retry_failed', 'post_corrections'));

