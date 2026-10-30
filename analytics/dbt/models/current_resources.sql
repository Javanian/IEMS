select * exclude(rank)
from (
  select *, row_number() over(partition by tenant_id, plant_id, aggregate_id order by aggregate_version desc) as rank
  from {{ ref('resource_history') }}
) where rank = 1 and not deleted
