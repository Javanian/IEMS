WITH sow_machine AS (
  SELECT
    w.machineid,
    s.idsow,
    s.order_no,
    s.ssbr_id,
    s.part_name,
    s.part_number,
    s.model,
    s.operation_no,
    s.operation_text,
    ROW_NUMBER() OVER (
      PARTITION BY w.machineid
      ORDER BY s.idsow DESC
    ) AS rn
  FROM public.workcenter w
  JOIN public.sow s
    ON s.workcenter = w.workcenternew
  WHERE w.machineid IS NOT NULL
    AND TRIM(w.machineid) <> ''
    AND s.order_no IS NOT NULL
    AND s.part_name IS NOT NULL
),
seed_rows AS (
  SELECT
    sm.machineid,
    sm.idsow,
    sm.order_no,
    sm.ssbr_id,
    sm.part_name,
    sm.operation_no,
    sm.operation_text,
    c.component_id,
    ROW_NUMBER() OVER (ORDER BY sm.machineid, sm.rn) AS global_rn,
    sm.rn
  FROM sow_machine sm
  LEFT JOIN public.components c
    ON c.part_number = sm.part_number
   AND (c.model = sm.model OR sm.model IS NULL OR c.model IS NULL)
  WHERE sm.rn <= 4
)
INSERT INTO public.buffer_transaction (
  machine_id,
  type,
  component_id,
  component_label,
  order_no,
  ssbr_id,
  operation_no,
  operation_text,
  "timestamp",
  reference_no,
  note
)
SELECT
  machineid,
  CASE WHEN rn % 2 = 1 THEN 'in' ELSE 'out' END,
  component_id,
  NULLIF(part_name, ''),
  order_no,
  ssbr_id,
  operation_no,
  operation_text,
  NOW() - (global_rn || ' minutes')::interval,
  'SEED-SOW-' || idsow,
  CONCAT_WS(' | ', 'Seed from SOW', operation_no::text, operation_text)
FROM seed_rows sr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.buffer_transaction bt
  WHERE bt.reference_no = 'SEED-SOW-' || sr.idsow
);
