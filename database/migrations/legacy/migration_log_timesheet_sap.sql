
CREATE TABLE IF NOT EXISTS log_timesheet_sap (
  id                        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ztimesheetid              TEXT,
  pernr                     TEXT,
  confirmation_number       TEXT,
  order_no                  TEXT,
  operation_no              TEXT,
  sequence_category         TEXT,
  sequence_number           TEXT,
  branch_operation_no       TEXT,
  return_operation_no       TEXT,
  zconf_type                TEXT,
  work_center               TEXT,
  activity_type             TEXT,
  start_date                TEXT,
  start_time                TEXT,
  end_date                  TEXT,
  end_time                  TEXT,
  plant_code                TEXT,
  final_completed_indicator TEXT,
  zbarcodeid                TEXT,
  sap_response              TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

