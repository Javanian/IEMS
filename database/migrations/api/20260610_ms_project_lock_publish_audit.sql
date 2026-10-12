create extension if not exists pgcrypto;

create or replace function set_ms_project_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

alter table ms_project
  add column if not exists published_revision_no integer,
  add column if not exists last_published_at timestamptz,
  add column if not exists checked_out_by text,
  add column if not exists checked_out_at timestamptz;

create table if not exists ms_project_lock (
  lock_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id) on delete cascade,
  lock_token text not null unique,
  locked_by text not null,
  locked_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id),
  constraint chk_ms_project_lock_expiry
    check (expires_at > locked_at)
);

create index if not exists idx_ms_project_lock_expiry
on ms_project_lock(expires_at);

drop trigger if exists trg_ms_project_lock_updated_at on ms_project_lock;
create trigger trg_ms_project_lock_updated_at
before update on ms_project_lock
for each row execute function set_ms_project_updated_at();

create table if not exists ms_project_revision (
  revision_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id) on delete cascade,
  revision_no integer not null,
  revision_type text not null,
  snapshot jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint chk_ms_project_revision_type
    check (revision_type in ('CREATE', 'SYNC', 'PUBLISH', 'FORCE_CHECKIN'))
);

create unique index if not exists uq_ms_project_revision_project_no_type
on ms_project_revision(project_id, revision_no, revision_type);

create index if not exists idx_ms_project_revision_project_created
on ms_project_revision(project_id, created_at desc);

create table if not exists ms_project_publish (
  publish_id uuid primary key default gen_random_uuid(),
  project_id uuid not null references ms_project(project_id) on delete cascade,
  revision_no integer not null,
  snapshot jsonb not null,
  published_by text,
  published_at timestamptz not null default now(),
  unique (project_id, revision_no)
);

create index if not exists idx_ms_project_publish_project_published
on ms_project_publish(project_id, published_at desc);

create table if not exists ms_project_audit_log (
  audit_id uuid primary key default gen_random_uuid(),
  project_id uuid references ms_project(project_id) on delete set null,
  action text not null,
  actor text,
  lock_token text,
  revision_no integer,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ms_project_audit_project_created
on ms_project_audit_log(project_id, created_at desc);

create index if not exists idx_ms_project_audit_action_created
on ms_project_audit_log(action, created_at desc);
