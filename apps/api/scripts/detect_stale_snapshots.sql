
SELECT (e->>'business_date')::date AS business_date, s.adoption_pct AS stored_pct, s.calculated_at
FROM ews.kpi_snapshot s
CROSS JOIN LATERAL (
  SELECT k->'detail'->'breakdown' AS bd
  FROM jsonb_array_elements(s.detail_json->'kpis') k WHERE k->>'key'='adoption_labour'
) kk
CROSS JOIN LATERAL jsonb_array_elements(kk.bd) e
WHERE s.scope_type='system' AND s.grain='today'
  AND e->>'operator_key' = :'serial'
  AND e->>'status' = 'SCHEDULED'
  AND (e->>'business_date')::date >= :'inactive_from'::date
GROUP BY 1,2,3
ORDER BY 1;

SELECT (e->>'business_date')::date AS business_date, count(DISTINCT e->>'operator_key') AS stale_ops,
       min(s.adoption_pct) AS stored_pct
FROM ews.kpi_snapshot s
CROSS JOIN LATERAL (
  SELECT k->'detail'->'breakdown' AS bd
  FROM jsonb_array_elements(s.detail_json->'kpis') k WHERE k->>'key'='adoption_labour'
) kk
CROSS JOIN LATERAL jsonb_array_elements(kk.bd) e
JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb),'') = e->>'operator_key'
WHERE s.scope_type='system' AND s.grain='today'
  AND u.inactive_from IS NOT NULL
  AND e->>'status' = 'SCHEDULED'
  AND (e->>'business_date')::date >= u.inactive_from
GROUP BY 1
ORDER BY 1;

SELECT (e->>'business_date')::date AS business_date,
       EXTRACT(dow FROM (e->>'business_date')::date)::int AS dow,
       s.adoption_pct AS stored_pct,
       count(*) AS stale_scheduled_ops,
       round(sum((e->>'standard_hours')::numeric),1) AS stale_std_hours
FROM ews.kpi_snapshot s
CROSS JOIN LATERAL (
  SELECT k->'detail'->'breakdown' AS bd
  FROM jsonb_array_elements(s.detail_json->'kpis') k WHERE k->>'key'='adoption_labour'
) kk
CROSS JOIN LATERAL jsonb_array_elements(kk.bd) e
JOIN ews.roster_workday_rule wr ON wr.day_of_week = EXTRACT(dow FROM (e->>'business_date')::date)::int
WHERE s.scope_type='system' AND s.grain='today'
  AND e->>'status'='SCHEDULED'
  AND (e->>'business_date')::date >= :'cutoff'::date
  AND ((e->>'shift'='DAY' AND NOT wr.runs_day) OR (e->>'shift'='NIGHT' AND NOT wr.runs_night))
GROUP BY 1,2,3
ORDER BY 1;

