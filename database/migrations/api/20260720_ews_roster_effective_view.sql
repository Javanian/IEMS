
CREATE OR REPLACE VIEW ews.roster_effective AS
SELECT
  r.serialnumber,
  r.business_date,
  r.status,
  r.source,
  r.updated_by,
  COALESCE(lk.locked_shift, r.scheduled_shift)               AS eff_shift,
  COALESCE(os_lk.standard_hours, r.scheduled_standard_hours) AS eff_std,
  (lk.id IS NOT NULL)                                        AS shift_locked
FROM ews.shift_roster r
LEFT JOIN ews.operator_shift_lock lk
       ON lk.serialnumber = r.serialnumber
      AND lk.cancelled_at IS NULL
      AND daterange(lk.effective_from, lk.lock_end, '[)') @> r.business_date
LEFT JOIN ews.operator_shift os_lk
       ON os_lk.shift_code = lk.locked_shift;

