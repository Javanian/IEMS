INSERT INTO ews.kpi_threshold (kpi_type, normal_min, warning_min, critical_below, owner)
VALUES
  ('uptime', 99, 98, 98, 'IT (Wira)'),
  ('accuracy', 98, 95, 95, 'Foreman/Spv'),
  ('adoption', 95, 90, 90, 'Foreman/Spv'),
  ('oee', 80, 65, 65, 'Foreman/Spv/PPIC'),
  ('ole', 85, 70, 70, 'Foreman/Spv/PPIC')
ON CONFLICT (kpi_type) DO UPDATE
SET normal_min = EXCLUDED.normal_min,
    warning_min = EXCLUDED.warning_min,
    critical_below = EXCLUDED.critical_below,
    owner = EXCLUDED.owner,
    updated_at = now();
