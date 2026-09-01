const db = global.pool || require('../db');

const GENERATE_SQL = `
WITH cfg AS (
  SELECT anchor_week_start, anchor_group_a_shift, rotation_period_weeks, week_start_dow
  FROM ews.rotation_config
  WHERE is_active
  ORDER BY effective_from DESC, id DESC
  LIMIT 1
),
dates AS (
  SELECT generate_series($1::date, $2::date, interval '1 day')::date AS bd
),
weeks AS (
  SELECT d.bd,
    d.bd - ((EXTRACT(dow FROM d.bd)::int - c.week_start_dow + 7) % 7) AS week_start,
    c.anchor_week_start, c.anchor_group_a_shift, c.rotation_period_weeks
  FROM dates d CROSS JOIN cfg c
),
parity AS (
  SELECT w.bd, w.anchor_group_a_shift,
    (((((w.week_start - w.anchor_week_start) / 7) / GREATEST(w.rotation_period_weeks, 1)) % 2) + 2) % 2 AS cycle_parity
  FROM weeks w
),
gshift AS (
  SELECT p.bd,
    CASE WHEN p.cycle_parity = 0 THEN p.anchor_group_a_shift
         ELSE CASE WHEN p.anchor_group_a_shift = 'DAY' THEN 'NIGHT' ELSE 'DAY' END END AS group_a_shift,
    CASE WHEN p.cycle_parity = 0
         THEN CASE WHEN p.anchor_group_a_shift = 'DAY' THEN 'NIGHT' ELSE 'DAY' END
         ELSE p.anchor_group_a_shift END AS group_b_shift
  FROM parity p
),
op_date AS (
  -- Exclude operators inactive AS OF each generated date: no NEW rows on/after inactive_from.
  -- LEFT JOIN so operators without a usernfc row are kept (inactive_from IS NULL). Existing frozen
  -- rows are never touched (ON CONFLICT DO NOTHING below); this only stops fresh rows being added.
  SELECT g.bd, org.serialnumber,
    CASE WHEN org.rotation_group = 'A' THEN g.group_a_shift ELSE g.group_b_shift END AS shift_code
  FROM gshift g
  CROSS JOIN ews.operator_rotation_group org
  LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = org.serialnumber
  WHERE u.inactive_from IS NULL OR g.bd < u.inactive_from
),
scheduled AS (
  SELECT od.bd, od.serialnumber, od.shift_code, os.standard_hours
  FROM op_date od
  JOIN ews.roster_workday_rule wr ON wr.day_of_week = EXTRACT(dow FROM od.bd)::int
  JOIN ews.operator_shift os ON os.shift_code = od.shift_code AND os.is_active
  WHERE (od.shift_code = 'DAY' AND wr.runs_day)
     OR (od.shift_code = 'NIGHT' AND wr.runs_night)
)
INSERT INTO ews.shift_roster
  (serialnumber, business_date, scheduled_shift, scheduled_standard_hours, status, source)
SELECT s.serialnumber, s.bd, s.shift_code, s.standard_hours, 'SCHEDULED', 'auto'
FROM scheduled s
ON CONFLICT (serialnumber, business_date) DO NOTHING
`;

async function generateRoster(fromDate, toDate) {
  const result = await db.query(GENERATE_SQL, [fromDate, toDate]);
  return result.rowCount;
}

module.exports = { generateRoster, GENERATE_SQL };
