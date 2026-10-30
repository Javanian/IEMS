with ordered as (
 select *, lag(aggregate_version,1,0) over(partition by tenant_id,plant_id,aggregate_id order by aggregate_version) as previous
 from {{ ref('event_versions') }}
)
select event_id from ordered where aggregate_version <> previous+1
