with latest as (
 select *, row_number() over(partition by tenant_id,plant_id order by observed_at desc,run_id) as rank
 from {{ source('raw','source_coverage') }}
), heads as (
 select *, row_number() over(partition by tenant_id,plant_id,aggregate_id order by aggregate_version desc) as rank
 from {{ ref('event_versions') }}
), expected as (
 select c.tenant_id,c.plant_id,c.run_id,
  json_extract_string(j.value,'$.aggregateId') as aggregate_id,
  cast(json_extract_string(j.value,'$.aggregateVersion') as bigint) as aggregate_version,
  json_extract_string(j.value,'$.hash') as checksum
 from latest c, json_each(json_extract(c.envelope,'$.snapshotHeads')) j
 where c.rank=1
), missing as (
 select e.tenant_id,e.plant_id,e.run_id,count(*) as missing_count
 from expected e
 left join heads h on h.tenant_id=e.tenant_id and h.plant_id=e.plant_id and h.rank=1
  and h.aggregate_id=e.aggregate_id and h.aggregate_version=e.aggregate_version and h.checksum=e.checksum
 where h.event_id is null
 group by e.tenant_id,e.plant_id,e.run_id
)
select c.tenant_id,c.plant_id,c.observed_at,
 (json_array_length(json_extract(c.envelope,'$.snapshotHeads')) =
  (select count(*) from heads h where h.tenant_id=c.tenant_id and h.plant_id=c.plant_id and h.rank=1)
  and coalesce(m.missing_count,0)=0) as complete
from latest c left join missing m
 on m.tenant_id=c.tenant_id and m.plant_id=c.plant_id and m.run_id=c.run_id
where c.rank=1
