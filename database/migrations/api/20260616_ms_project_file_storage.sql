alter table public.ms_project
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists file_uploaded_at timestamptz;
