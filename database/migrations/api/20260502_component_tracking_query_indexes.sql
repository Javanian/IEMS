CREATE INDEX IF NOT EXISTS idx_ts_component_tracking_active
  ON public.timesheet_transaction (workcentercode, longdate_checkout, longdate_checkin DESC)
  WHERE longdate_checkin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ts_component_tracking_productive
  ON public.timesheet_transaction (workcentercode, order_no, operation_no, longdate_checkin)
  WHERE activitytype IS NULL AND longdate_checkin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ph3_order_order_description
  ON public.ph3_order (order_no, order_description);
