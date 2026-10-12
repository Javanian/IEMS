
SELECT business_date::text AS bd, status, source, count(*) AS rows_to_flip
FROM ews.shift_roster
WHERE EXTRACT(dow FROM business_date)::int = 6
  AND business_date >= '2026-07-14'
  AND status = 'SCHEDULED'
  AND source IS DISTINCT FROM 'manual'
GROUP BY business_date, status, source
ORDER BY business_date;

BEGIN;

UPDATE ews.shift_roster
SET status     = 'OFF',
    source     = 'manual',
    updated_by = 'ews-roster-cleanup',
    updated_at = now()
WHERE EXTRACT(dow FROM business_date)::int = 6
  AND business_date >= '2026-07-14'
  AND status = 'SCHEDULED'
  AND source IS DISTINCT FROM 'manual';

SELECT business_date::text AS bd, status, count(*) AS n
FROM ews.shift_roster
WHERE EXTRACT(dow FROM business_date)::int = 6
  AND business_date >= '2026-07-14'
GROUP BY business_date, status
ORDER BY business_date, status;

COMMIT;

