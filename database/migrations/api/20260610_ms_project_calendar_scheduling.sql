create extension if not exists pgcrypto;

create or replace function set_ms_project_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists ms_project_calendar (
  calendar_id uuid primary key default gen_random_uuid(),
  calendar_code text not null unique,
  calendar_name text not null,
  calendar_scope text not null default 'BASE',
  base_calendar_id uuid references ms_project_calendar(calendar_id) on delete restrict,
  calendar_guid uuid,
  is_enterprise boolean not null default true,
  is_default boolean not null default false,
  is_active boolean not null default true,
  hours_per_day numeric(10,2) not null default 8,
  hours_per_week numeric(10,2) not null default 40,
  days_per_month numeric(10,2) not null default 20,
  default_start_time time not null default '08:00',
  default_finish_time time not null default '17:00',
  timezone text not null default 'Asia/Jakarta',
  description text,
  source_type text not null default 'MPS',
  source_ref_id text,
  version_no integer not null default 1,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ms_project_calendar_scope
    check (calendar_scope in ('BASE', 'PROJECT', 'RESOURCE', 'TASK')),
  constraint chk_ms_project_calendar_hours_positive
    check (hours_per_day > 0 and hours_per_week > 0 and days_per_month > 0),
  constraint chk_ms_project_calendar_version_positive
    check (version_no > 0)
);

create unique index if not exists uq_ms_project_calendar_code_ci
on ms_project_calendar(lower(calendar_code));

create unique index if not exists uq_ms_project_calendar_guid
on ms_project_calendar(calendar_guid)
where calendar_guid is not null;

create unique index if not exists uq_ms_project_calendar_source
on ms_project_calendar(source_type, source_ref_id)
where source_ref_id is not null;

create index if not exists idx_ms_project_calendar_active_scope
on ms_project_calendar(is_active, calendar_scope);

drop trigger if exists trg_ms_project_calendar_updated_at on ms_project_calendar;
create trigger trg_ms_project_calendar_updated_at
before update on ms_project_calendar
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_calendar_weekday (
  calendar_weekday_id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references ms_project_calendar(calendar_id) on delete cascade,
  day_of_week integer not null,
  day_type text not null default 'WORKING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, day_of_week),
  constraint chk_ms_project_calendar_weekday_dow
    check (day_of_week between 1 and 7),
  constraint chk_ms_project_calendar_weekday_type
    check (day_type in ('WORKING', 'NON_WORKING', 'DEFAULT'))
);

drop trigger if exists trg_ms_project_calendar_weekday_updated_at on ms_project_calendar_weekday;
create trigger trg_ms_project_calendar_weekday_updated_at
before update on ms_project_calendar_weekday
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_calendar_working_time (
  working_time_id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references ms_project_calendar(calendar_id) on delete cascade,
  day_of_week integer not null,
  segment_no integer not null default 1,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, day_of_week, segment_no),
  constraint chk_ms_project_calendar_working_time_dow
    check (day_of_week between 1 and 7),
  constraint chk_ms_project_calendar_working_time_segment
    check (segment_no between 1 and 5)
);

create index if not exists idx_ms_project_calendar_working_time_calendar_day
on ms_project_calendar_working_time(calendar_id, day_of_week);

drop trigger if exists trg_ms_project_calendar_working_time_updated_at on ms_project_calendar_working_time;
create trigger trg_ms_project_calendar_working_time_updated_at
before update on ms_project_calendar_working_time
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_calendar_exception (
  exception_id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references ms_project_calendar(calendar_id) on delete cascade,
  exception_name text not null,
  exception_type text not null default 'NON_WORKING',
  start_date date not null,
  end_date date not null,
  recurrence_rule jsonb,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ms_project_calendar_exception_type
    check (exception_type in ('WORKING', 'NON_WORKING', 'REDUCED_WORKING')),
  constraint chk_ms_project_calendar_exception_window
    check (end_date >= start_date)
);

create index if not exists idx_ms_project_calendar_exception_calendar_dates
on ms_project_calendar_exception(calendar_id, start_date, end_date)
where is_active = true;

drop trigger if exists trg_ms_project_calendar_exception_updated_at on ms_project_calendar_exception;
create trigger trg_ms_project_calendar_exception_updated_at
before update on ms_project_calendar_exception
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_calendar_exception_time (
  exception_time_id uuid primary key default gen_random_uuid(),
  exception_id uuid not null references ms_project_calendar_exception(exception_id) on delete cascade,
  segment_no integer not null default 1,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exception_id, segment_no),
  constraint chk_ms_project_calendar_exception_time_segment
    check (segment_no between 1 and 5)
);

drop trigger if exists trg_ms_project_calendar_exception_time_updated_at on ms_project_calendar_exception_time;
create trigger trg_ms_project_calendar_exception_time_updated_at
before update on ms_project_calendar_exception_time
for each row execute function set_ms_project_updated_at();

alter table ms_project
  add column if not exists calendar_id uuid references ms_project_calendar(calendar_id),
  add column if not exists calendar_name text;

alter table ms_resource
  add column if not exists calendar_id uuid references ms_project_calendar(calendar_id),
  add column if not exists calendar_name text;

alter table ms_project_task
  add column if not exists calendar_id uuid references ms_project_calendar(calendar_id),
  add column if not exists calendar_name text,
  add column if not exists ignore_resource_calendar boolean not null default false;

create index if not exists idx_ms_project_calendar_id
on ms_project(calendar_id);

create index if not exists idx_ms_resource_calendar_id
on ms_resource(calendar_id);

create index if not exists idx_ms_project_task_calendar_id
on ms_project_task(calendar_id);

create table if not exists ms_project_resource_availability (
  availability_id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references ms_resource(resource_id) on delete cascade,
  available_from date,
  available_to date,
  max_units numeric(10,4) not null default 1,
  calendar_id uuid references ms_project_calendar(calendar_id),
  source_type text not null default 'MPS',
  source_ref_id text,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ms_project_resource_availability_units
    check (max_units > 0),
  constraint chk_ms_project_resource_availability_window
    check (available_to is null or available_from is null or available_to >= available_from)
);

create index if not exists idx_ms_project_resource_availability_resource_window
on ms_project_resource_availability(resource_id, available_from, available_to);

create unique index if not exists uq_ms_project_resource_availability_source
on ms_project_resource_availability(resource_id, source_type, source_ref_id)
where source_ref_id is not null;

drop trigger if exists trg_ms_project_resource_availability_updated_at on ms_project_resource_availability;
create trigger trg_ms_project_resource_availability_updated_at
before update on ms_project_resource_availability
for each row execute function set_ms_project_updated_at();

insert into ms_project_calendar (
  calendar_code,
  calendar_name,
  calendar_scope,
  is_enterprise,
  is_default,
  hours_per_day,
  hours_per_week,
  days_per_month,
  default_start_time,
  default_finish_time,
  timezone,
  description,
  source_type,
  source_ref_id,
  created_by,
  updated_by
)
values
  ('STANDARD', 'Standard', 'BASE', true, true, 8, 40, 20, '08:00', '17:00', 'Asia/Jakarta', 'Default Monday-Friday working calendar for MS Project integration.', 'MPS_DEFAULT', 'STANDARD', 'migration', 'migration'),
  ('24H', '24 Hours', 'BASE', true, false, 24, 168, 30, '00:00', '00:00', 'Asia/Jakarta', 'Continuous working calendar for elapsed/always-on work.', 'MPS_DEFAULT', '24H', 'migration', 'migration'),
  ('NIGHT_SHIFT', 'Night Shift', 'BASE', true, false, 8, 40, 20, '23:00', '07:00', 'Asia/Jakarta', 'Default cross-midnight night shift calendar.', 'MPS_DEFAULT', 'NIGHT_SHIFT', 'migration', 'migration')
on conflict (calendar_code)
do update set
  calendar_name = excluded.calendar_name,
  calendar_scope = excluded.calendar_scope,
  is_enterprise = excluded.is_enterprise,
  is_default = excluded.is_default,
  hours_per_day = excluded.hours_per_day,
  hours_per_week = excluded.hours_per_week,
  days_per_month = excluded.days_per_month,
  default_start_time = excluded.default_start_time,
  default_finish_time = excluded.default_finish_time,
  timezone = excluded.timezone,
  description = excluded.description,
  source_type = excluded.source_type,
  source_ref_id = excluded.source_ref_id,
  updated_by = excluded.updated_by;

with calendars as (
  select calendar_id, calendar_code
  from ms_project_calendar
  where calendar_code in ('STANDARD', '24H', 'NIGHT_SHIFT')
),
days as (
  select generate_series(1, 7) as day_of_week
)
insert into ms_project_calendar_weekday (calendar_id, day_of_week, day_type)
select
  c.calendar_id,
  d.day_of_week,
  case
    when c.calendar_code = '24H' then 'WORKING'
    when d.day_of_week between 1 and 5 then 'WORKING'
    else 'NON_WORKING'
  end
from calendars c
cross join days d
on conflict (calendar_id, day_of_week)
do update set day_type = excluded.day_type;

with standard_calendar as (
  select calendar_id from ms_project_calendar where calendar_code = 'STANDARD'
),
standard_segments as (
  select day_of_week, segment_no, start_time::time, end_time::time, false as crosses_midnight
  from generate_series(1, 5) as day_of_week
  cross join (values
    (1, '08:00', '12:00'),
    (2, '13:00', '17:00')
  ) as segment(segment_no, start_time, end_time)
)
insert into ms_project_calendar_working_time (calendar_id, day_of_week, segment_no, start_time, end_time, crosses_midnight)
select c.calendar_id, s.day_of_week, s.segment_no, s.start_time, s.end_time, s.crosses_midnight
from standard_calendar c
cross join standard_segments s
on conflict (calendar_id, day_of_week, segment_no)
do update set
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  crosses_midnight = excluded.crosses_midnight;

with continuous_calendar as (
  select calendar_id from ms_project_calendar where calendar_code = '24H'
),
days as (
  select generate_series(1, 7) as day_of_week
)
insert into ms_project_calendar_working_time (calendar_id, day_of_week, segment_no, start_time, end_time, crosses_midnight)
select c.calendar_id, d.day_of_week, 1, '00:00'::time, '00:00'::time, true
from continuous_calendar c
cross join days d
on conflict (calendar_id, day_of_week, segment_no)
do update set
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  crosses_midnight = excluded.crosses_midnight;

with night_calendar as (
  select calendar_id from ms_project_calendar where calendar_code = 'NIGHT_SHIFT'
),
days as (
  select generate_series(1, 5) as day_of_week
)
insert into ms_project_calendar_working_time (calendar_id, day_of_week, segment_no, start_time, end_time, crosses_midnight)
select c.calendar_id, d.day_of_week, 1, '23:00'::time, '07:00'::time, true
from night_calendar c
cross join days d
on conflict (calendar_id, day_of_week, segment_no)
do update set
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  crosses_midnight = excluded.crosses_midnight;

update ms_project p
set calendar_id = c.calendar_id,
    calendar_name = c.calendar_name
from ms_project_calendar c
where c.calendar_code = 'STANDARD'
  and p.calendar_id is null;

update ms_resource r
set calendar_id = c.calendar_id,
    calendar_name = c.calendar_name
from ms_project_calendar c
where c.calendar_code = 'STANDARD'
  and r.calendar_id is null
  and r.resource_type = 'WORK';
