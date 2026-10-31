with deliveries as (
 select tenant_id,plant_id,order_id,uom,sum(quantity) as fulfilled_quantity
 from {{ ref('current_resources') }} where resource_type='fulfillment'
 group by tenant_id,plant_id,order_id,uom
)
select q.*,
 case when c.complete then coalesce(d.fulfilled_quantity,0) end::decimal(38,12) as fulfilled_quantity,
 case when c.complete then q.ordered_quantity-coalesce(d.fulfilled_quantity,0) end::decimal(38,12) as remaining_quantity
from {{ ref('order_quantities') }} q
left join deliveries d using(tenant_id,plant_id,order_id,uom)
left join {{ ref('coverage_status') }} c using(tenant_id,plant_id)
