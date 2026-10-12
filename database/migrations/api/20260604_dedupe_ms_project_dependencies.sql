with ranked_dependencies as (
  select
    dependency_id,
    row_number() over (
      partition by
        project_id,
        predecessor_task_id,
        successor_task_id,
        coalesce(dependency_type, 'FS'),
        coalesce(lag_minutes, 0)
      order by is_active desc, created_at, dependency_id
    ) as rn
  from ms_project_dependency
)
delete from ms_project_dependency d
using ranked_dependencies r
where d.dependency_id = r.dependency_id
  and r.rn > 1;

with inactive_duplicates as (
  select
    dependency_id,
    row_number() over (
      partition by project_id, local_dependency_key
      order by is_active desc, created_at, dependency_id
    ) as rn
  from ms_project_dependency
  where local_dependency_key is not null
)
delete from ms_project_dependency d
using inactive_duplicates r
where d.dependency_id = r.dependency_id
  and r.rn > 1;

create unique index if not exists uq_ms_project_dependency_active_pair
on ms_project_dependency(
  project_id,
  predecessor_task_id,
  successor_task_id,
  coalesce(dependency_type, 'FS'),
  coalesce(lag_minutes, 0)
)
where is_active = true;
