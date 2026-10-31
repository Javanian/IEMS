with versions as (
  select *,
    json_extract_string(envelope, '$.payload.resourceType') as resource_type,
    json_extract_string(envelope, '$.payload.orderId') as order_id,
    json_extract_string(envelope, '$.payload.currency') as currency,
    json_extract_string(envelope, '$.payload.uom') as uom,
    cast(json_extract_string(envelope, '$.payload.amount') as decimal(38, 12)) as amount,
    cast(json_extract_string(envelope, '$.payload.quantity') as decimal(38, 12)) as quantity,
    coalesce(cast(json_extract_string(envelope, '$.payload.deleted') as boolean), false) as deleted
  from {{ ref('event_versions') }}
)
select *, occurred_at as valid_from,
       lead(occurred_at) over(partition by tenant_id, plant_id, aggregate_id order by aggregate_version) as valid_to,
       lead(available_at) over(partition by tenant_id, plant_id, aggregate_id order by aggregate_version) as known_until
from versions
