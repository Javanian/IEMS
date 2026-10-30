select r.tenant_id,r.plant_id,r.aggregate_id as order_id,
 json_extract_string(q.value,'$.uom') as uom,
 cast(json_extract_string(q.value,'$.quantity') as decimal(38,12)) as ordered_quantity
from {{ ref('current_resources') }} r,
json_each(json_extract(r.envelope,'$.payload.quantities')) q
where r.resource_type='order'
