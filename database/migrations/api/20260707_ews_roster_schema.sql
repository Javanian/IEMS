
BEGIN;

CREATE TABLE IF NOT EXISTS ews.operator_shift (
  shift_code text PRIMARY KEY,
  shift_name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  standard_hours numeric NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ews.roster_workday_rule (
  day_of_week int PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
  runs_day boolean NOT NULL DEFAULT false,
  runs_night boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ews.rotation_config (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anchor_week_start date NOT NULL,
  anchor_group_a_shift text NOT NULL CHECK (anchor_group_a_shift IN ('DAY','NIGHT')),
  rotation_period_weeks int NOT NULL DEFAULT 1,
  week_start_dow int NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ews.operator_rotation_group (
  serialnumber text PRIMARY KEY,
  rotation_group text NOT NULL CHECK (rotation_group IN ('A','B')),
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  effective_from date NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ews.shift_roster (
  serialnumber text NOT NULL,
  business_date date NOT NULL,
  scheduled_shift text REFERENCES ews.operator_shift(shift_code),
  scheduled_standard_hours numeric,
  status text NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','OFF','LEAVE','SICK','PERMIT')),
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (serialnumber, business_date)
);

CREATE INDEX IF NOT EXISTS idx_ews_shift_roster_date   ON ews.shift_roster (business_date);
CREATE INDEX IF NOT EXISTS idx_ews_shift_roster_status ON ews.shift_roster (business_date, status);

INSERT INTO ews.operator_shift (shift_code, shift_name, start_time, end_time, crosses_midnight, standard_hours)
VALUES
  ('DAY',   'Shift 1 (Day)',   TIME '08:00', TIME '17:00', false, 8),
  ('NIGHT', 'Shift 2 (Night)', TIME '20:00', TIME '04:00', true,  7)
ON CONFLICT (shift_code) DO NOTHING;

INSERT INTO ews.roster_workday_rule (day_of_week, runs_day, runs_night) VALUES
  (0, false, false),
  (1, true,  true),
  (2, true,  true),
  (3, true,  true),
  (4, true,  true),
  (5, true,  true),
  (6, true,  false)
ON CONFLICT (day_of_week) DO NOTHING;

INSERT INTO ews.rotation_config (anchor_week_start, anchor_group_a_shift, rotation_period_weeks, week_start_dow, effective_from)
SELECT DATE '2026-06-28', 'DAY', 1, 0, DATE '2026-06-28'
WHERE NOT EXISTS (SELECT 1 FROM ews.rotation_config);

COMMIT;

