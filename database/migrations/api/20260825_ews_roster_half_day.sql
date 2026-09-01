-- 20260825_ews_roster_half_day.sql
-- Half-day roster: operator yang masuk SETENGAH HARI hanya dituntut setengah jam
-- standar shift-nya. Kolom half_day per (serialnumber, business_date) di
-- ews.shift_roster; VIEW ews.roster_effective membagi dua eff_std sehingga semua
-- konsumen (getRoster harian + denominator adoption ewsCalculator) otomatis
-- menghitung setengah jam — satu sumber kebenaran, tanpa ubah kalkulator.

ALTER TABLE ews.shift_roster
  ADD COLUMN IF NOT EXISTS half_day boolean NOT NULL DEFAULT false;

-- DROP dulu: CREATE OR REPLACE tidak bisa menambah kolom baru di tengah urutan
-- (kolom lama berakhir di shift_locked). View read-only, aman di-drop.
DROP VIEW IF EXISTS ews.roster_effective;

CREATE VIEW ews.roster_effective AS
SELECT
  r.serialnumber,
  r.business_date,
  r.status,
  r.source,
  r.updated_by,
  COALESCE(lk.locked_shift, r.scheduled_shift)               AS eff_shift,
  CASE WHEN COALESCE(r.half_day, false)
       THEN (COALESCE(os_lk.standard_hours, r.scheduled_standard_hours)) / 2.0
       ELSE COALESCE(os_lk.standard_hours, r.scheduled_standard_hours)
  END                                                         AS eff_std,
  COALESCE(r.half_day, false)                                 AS half_day,
  (lk.id IS NOT NULL)                                         AS shift_locked
FROM ews.shift_roster r
LEFT JOIN ews.operator_shift_lock lk
       ON lk.serialnumber = r.serialnumber
      AND lk.cancelled_at IS NULL
      AND daterange(lk.effective_from, lk.lock_end, '[)') @> r.business_date
LEFT JOIN ews.operator_shift os_lk
       ON os_lk.shift_code = lk.locked_shift
LEFT JOIN public.usernfc u
       ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
WHERE u.inactive_from IS NULL OR r.business_date < u.inactive_from;
