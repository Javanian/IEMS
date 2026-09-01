create extension if not exists pgcrypto;

create or replace function set_ms_project_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists ms_project (
  project_id uuid primary key default gen_random_uuid(),
  project_name text not null,
  description text,
  status text not null default 'ACTIVE',
  source_type text default 'MS_PROJECT',
  revision_no integer not null default 1,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ms_project_status_updated
on ms_project(status, updated_at desc);

drop trigger if exists trg_ms_project_updated_at on ms_project;
create trigger trg_ms_project_updated_at
before update on ms_project
for each row execute function set_ms_project_updated_at();

create table if not exists ms_resource (
  resource_id uuid primary key default gen_random_uuid(),
  resource_code text unique not null,
  resource_name text not null,
  resource_type text not null default 'WORK',
  resource_category text not null,
  source_type text not null,
  source_ref_id text,
  employee_id text null,
  machine_id text null,
  workcenter_code text null,
  parent_resource_id uuid null references ms_resource(resource_id),
  max_units numeric(10,2) not null default 1,
  is_assignable boolean not null default true,
  is_generic boolean not null default false,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ms_resource_type
    check (resource_type in ('WORK', 'MATERIAL', 'COST')),
  constraint chk_ms_resource_category
    check (resource_category in ('PERSON', 'MACHINE', 'WORKCENTER', 'TEAM', 'MATERIAL')),
  constraint chk_ms_resource_max_units_positive
    check (max_units > 0)
);

create unique index if not exists uq_ms_resource_source
on ms_resource(source_type, source_ref_id)
where source_ref_id is not null;

create index if not exists idx_ms_resource_search
on ms_resource(resource_category, is_active, resource_code);

create index if not exists idx_ms_resource_workcenter
on ms_resource(workcenter_code)
where workcenter_code is not null;

drop trigger if exists trg_ms_resource_updated_at on ms_resource;
create trigger trg_ms_resource_updated_at
before update on ms_resource
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_task (
  task_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id),
  parent_task_id uuid null,
  task_name text not null,
  outline_level integer,
  outline_number text,
  order_no text,
  operation_no text,
  ssbr_id text,
  sow_id integer null,
  workcenter text,
  plan_start timestamptz,
  plan_finish timestamptz,
  duration_minutes integer,
  planned_work_minutes integer,
  actual_start timestamptz,
  actual_finish timestamptz,
  actual_work_minutes integer,
  actual_progress numeric(5,2),
  actual_source text,
  actual_updated_at timestamptz,
  is_summary boolean not null default false,
  is_active boolean not null default true,
  local_task_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, task_id),
  constraint fk_ms_project_task_parent_same_project
    foreign key (project_id, parent_task_id)
    references ms_project_task(project_id, task_id)
);

create index if not exists idx_ms_project_task_project
on ms_project_task(project_id, is_active);

create index if not exists idx_ms_project_task_business
on ms_project_task(project_id, order_no, operation_no);

create index if not exists idx_ms_project_task_window
on ms_project_task(plan_start, plan_finish);

create unique index if not exists uq_ms_project_task_local_uid
on ms_project_task(project_id, local_task_uid)
where local_task_uid is not null;

drop trigger if exists trg_ms_project_task_updated_at on ms_project_task;
create trigger trg_ms_project_task_updated_at
before update on ms_project_task
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_resource (
  project_resource_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id),
  resource_id uuid not null references ms_resource(resource_id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, resource_id)
);

create index if not exists idx_ms_project_resource_project
on ms_project_resource(project_id, is_active);

drop trigger if exists trg_ms_project_resource_updated_at on ms_project_resource;
create trigger trg_ms_project_resource_updated_at
before update on ms_project_resource
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_assignment (
  assignment_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id),
  task_id uuid not null,
  resource_id uuid not null references ms_resource(resource_id),
  assignment_units numeric(10,2) not null default 1,
  planned_work_minutes integer,
  actual_work_minutes integer,
  actual_start timestamptz,
  actual_finish timestamptz,
  assignment_start timestamptz,
  assignment_finish timestamptz,
  is_active boolean not null default true,
  local_assignment_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, assignment_id),
  constraint chk_ms_project_assignment_units_positive
    check (assignment_units > 0),
  constraint fk_ms_project_assignment_task_same_project
    foreign key (project_id, task_id)
    references ms_project_task(project_id, task_id),
  constraint fk_ms_project_assignment_project_resource
    foreign key (project_id, resource_id)
    references ms_project_resource(project_id, resource_id)
);

create index if not exists idx_ms_project_assignment_resource_window
on ms_project_assignment(resource_id, assignment_start, assignment_finish)
where is_active = true;

create index if not exists idx_ms_project_assignment_project
on ms_project_assignment(project_id, is_active);

create unique index if not exists uq_ms_project_assignment_local_uid
on ms_project_assignment(project_id, local_assignment_uid)
where local_assignment_uid is not null;

drop trigger if exists trg_ms_project_assignment_updated_at on ms_project_assignment;
create trigger trg_ms_project_assignment_updated_at
before update on ms_project_assignment
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_dependency (
  dependency_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id),
  predecessor_task_id uuid not null,
  successor_task_id uuid not null,
  dependency_type text,
  lag_minutes integer,
  local_dependency_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, dependency_id),
  constraint fk_ms_project_dependency_pred_same_project
    foreign key (project_id, predecessor_task_id)
    references ms_project_task(project_id, task_id),
  constraint fk_ms_project_dependency_succ_same_project
    foreign key (project_id, successor_task_id)
    references ms_project_task(project_id, task_id)
);

create unique index if not exists uq_ms_project_dependency_local_key
on ms_project_dependency(project_id, local_dependency_key)
where local_dependency_key is not null;

create index if not exists idx_ms_project_dependency_project
on ms_project_dependency(project_id, is_active);

drop trigger if exists trg_ms_project_dependency_updated_at on ms_project_dependency;
create trigger trg_ms_project_dependency_updated_at
before update on ms_project_dependency
for each row execute function set_ms_project_updated_at();
