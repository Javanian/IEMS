
BEGIN;

INSERT INTO parts (partnumber, partname, model, drawing_path)
SELECT DISTINCT
    s.part_number,
    s.part_name,
    s.model,
    NULL as drawing_path
FROM sow s
WHERE s.part_number IS NOT NULL
  AND s.part_number <> ''
  AND s.model IS NOT NULL
  AND s.model <> ''
  AND s.part_name IS NOT NULL
  AND s.part_name <> ''
ON CONFLICT (partnumber) DO UPDATE
SET
    partname = EXCLUDED.partname,
    model = EXCLUDED.model,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO operations (
    part_id,
    opr_no,
    operationtext,
    wct_group,
    workcenter,
    planhours,
    drawing_path,
    remark
)
SELECT
    p.part_id,
    s.operation_no,
    COALESCE(s.operationtext, 'No description'),
    s.wct_group,
    s.workcenter,
    s.planhours,
    NULL as drawing_path,
    s.remark
FROM sow s
JOIN parts p ON s.part_number = p.partnumber
WHERE s.part_number IS NOT NULL
  AND s.part_number <> ''
  AND s.operation_no IS NOT NULL
ON CONFLICT (part_id, opr_no) DO UPDATE
SET
    operationtext = EXCLUDED.operationtext,
    wct_group = EXCLUDED.wct_group,
    workcenter = EXCLUDED.workcenter,
    planhours = EXCLUDED.planhours,
    remark = EXCLUDED.remark,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;

SELECT
    'Parts in SOW (distinct)' as description,
    COUNT(DISTINCT part_number) as count
FROM sow
WHERE part_number <> '' AND part_number IS NOT NULL

UNION ALL

SELECT
    'Parts migrated to parts table' as description,
    COUNT(*) as count
FROM parts

UNION ALL

SELECT
    'Operations in SOW' as description,
    COUNT(*) as count
FROM sow
WHERE part_number <> '' AND part_number IS NOT NULL

UNION ALL

SELECT
    'Operations migrated to operations table' as description,
    COUNT(*) as count
FROM operations;

SELECT
    'Parts without operations' as issue,
    COUNT(*) as count
FROM parts p
LEFT JOIN operations o ON p.part_id = o.part_id
WHERE o.operation_id IS NULL;

SELECT
    'Duplicate operation numbers' as issue,
    COUNT(*) as count
FROM (
    SELECT part_id, opr_no, COUNT(*) as cnt
    FROM operations
    GROUP BY part_id, opr_no
    HAVING COUNT(*) > 1
) duplicates;

SELECT
    p.partnumber,
    p.partname,
    p.model,
    COUNT(o.operation_id) as total_operations,
    SUM(o.planhours) as total_hours
FROM parts p
LEFT JOIN operations o ON p.part_id = o.part_id
GROUP BY p.part_id, p.partnumber, p.partname, p.model
ORDER BY p.partnumber
LIMIT 5;