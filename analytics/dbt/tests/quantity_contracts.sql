select order_id from {{ ref('order_quantities') }}
group by tenant_id,plant_id,order_id,uom
having count(*)<>1 or min(ordered_quantity)<0 or uom is null
