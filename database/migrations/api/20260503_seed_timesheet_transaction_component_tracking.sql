WITH seed_count AS (
  SELECT COUNT(*)::int AS existing_count
  FROM public.timesheet_transaction
  WHERE note = 'SEED-COMPONENT-TRACKING-20260503'
),
candidate_source AS (
  SELECT DISTINCT ON (u.machineid)
    u.snssb,
    u.full_name,
    u.machineid,
    w.workcenternew,
    w.workcenter_description,
    s.order_no,
    s.ssbr_id,
    NULLIF(s.part_name, '') AS part_name,
    s.operation_no,
    s.operation_text,
    s.planhours
  FROM public.usernfc u
  JOIN public.workcenter w
    ON w.machineid = u.machineid
  JOIN LATERAL (
    SELECT
      sow.order_no,
      sow.ssbr_id,
      sow.part_name,
      sow.operation_no,
      sow.operation_text,
      sow.planhours
    FROM public.sow
    WHERE sow.workcenter = w.workcenternew
      AND sow.order_no IS NOT NULL
      AND sow.operation_no IS NOT NULL
      AND sow.operation_text IS NOT NULL
    ORDER BY
      (sow.ssbr_id IS NOT NULL) DESC,
      sow.idsow DESC
    LIMIT 1
  ) s ON TRUE
  WHERE u.snssb IS NOT NULL
    AND TRIM(u.snssb) <> ''
    AND u.full_name IS NOT NULL
    AND TRIM(u.full_name) <> ''
    AND u.machineid IS NOT NULL
    AND TRIM(u.machineid) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM public.timesheet_transaction open_ts
      WHERE open_ts.serialnumber = u.snssb
        AND open_ts.longdate_checkout IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.timesheet_transaction open_machine_ts
      JOIN public.usernfc open_user
        ON open_user.snssb = open_machine_ts.serialnumber
      WHERE open_machine_ts.longdate_checkout IS NULL
        AND open_user.machineid = u.machineid
    )
  ORDER BY u.machineid, u.full_name
),
seed_source AS (
  SELECT
    cs.*,
    ROW_NUMBER() OVER (ORDER BY cs.machineid, cs.full_name) AS rn
  FROM candidate_source cs
  CROSS JOIN seed_count sc
  ORDER BY cs.machineid, cs.full_name
  LIMIT GREATEST(0, 7 - (SELECT existing_count FROM seed_count))
)
INSERT INTO public.timesheet_transaction (
  order_no,
  ssbr_id,
  part_name,
  serialnumber,
  full_name,
  operation_no,
  operation_text,
  workcentercode,
  workcenterdescription,
  planhours,
  longdate_checkin,
  date_checkin,
  hour_checkin,
  plant,
  activitytype,
  note
)
SELECT
  order_no,
  ssbr_id,
  part_name,
  snssb,
  full_name,
  operation_no,
  operation_text,
  workcenternew,
  workcenter_description,
  planhours,
  NOW() - (rn * INTERVAL '7 minutes'),
  to_char(NOW() - (rn * INTERVAL '7 minutes'), 'DD/MM/YYYY'),
  to_char(NOW() - (rn * INTERVAL '7 minutes'), 'HH24:MI'),
  '5100',
  NULL,
  'SEED-COMPONENT-TRACKING-20260503'
FROM seed_source ss
WHERE NOT EXISTS (
  SELECT 1
  FROM public.timesheet_transaction existing_seed
  WHERE existing_seed.note = 'SEED-COMPONENT-TRACKING-20260503'
    AND existing_seed.serialnumber = ss.snssb
    AND existing_seed.longdate_checkout IS NULL
);
