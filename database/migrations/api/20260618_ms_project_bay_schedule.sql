create extension if not exists pgcrypto;

create or replace function set_ms_project_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists ms_project_bay_schedule (
  schedule_id uuid primary key default gen_random_uuid(),
  order_no text not null,
  project_id uuid null references ms_project(project_id) on delete set null,
  task_id uuid null,
  area_code text not null,
  area_name text not null,
  bay_codes text[] not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'RESERVED',
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ms_project_bay_schedule_window
    check (end_date >= start_date),
  constraint chk_ms_project_bay_schedule_status
    check (status in ('RESERVED', 'CONFIRMED', 'DONE', 'CANCELLED')),
  constraint chk_ms_project_bay_schedule_bays_not_empty
    check (array_length(bay_codes, 1) > 0),
  constraint fk_ms_project_bay_schedule_task
    foreign key (project_id, task_id)
    references ms_project_task(project_id, task_id)
);

create index if not exists idx_ms_project_bay_schedule_window
on ms_project_bay_schedule(start_date, end_date)
where status in ('RESERVED', 'CONFIRMED');

create index if not exists idx_ms_project_bay_schedule_order
on ms_project_bay_schedule(order_no, start_date desc);

create index if not exists idx_ms_project_bay_schedule_bays
on ms_project_bay_schedule using gin (bay_codes)
where status in ('RESERVED', 'CONFIRMED');

drop trigger if exists trg_ms_project_bay_schedule_updated_at on ms_project_bay_schedule;
create trigger trg_ms_project_bay_schedule_updated_at
before update on ms_project_bay_schedule
for each row execute function set_ms_project_updated_at();
