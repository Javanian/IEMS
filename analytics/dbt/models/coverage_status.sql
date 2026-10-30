with latest as (
 select *, row_number() over(partition by tenant_id,plant_id order by observed_at desc,run_id) as rank
 from {{ source('raw','source_coverage') }}
), heads as (
 select *, row_number() over(partition by tenant_id,plant_id,aggregate_id order by aggregate_version desc) as rank
 from {{ ref('event_versions') }}
)
select c.tenant_id,c.plant_id,c.observed_at,
 (json_array_length(json_extract(c.envelope,'$.snapshotHeads')) =
  (select count(*) from heads h where h.tenant_id=c.tenant_id and h.plant_id=c.plant_id and h.rank=1)
  and not exists (
    select 1 from json_each(json_extract(c.envelope,'$.snapshotHeads')) j
    left join heads h on h.tenant_id=c.tenant_id and h.plant_id=c.plant_id and h.rank=1
     and h.aggregate_id=json_extract_string(j.value,'$.aggregateId')
     and h.aggregate_version=cast(json_extract_string(j.value,'$.aggregateVersion') as bigint)
     and h.checksum=json_extract_string(j.value,'$.hash')
    where h.event_id is null
  )) as complete
from latest c where c.rank=1
