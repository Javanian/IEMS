with orders as (
 select tenant_id, plant_id, aggregate_id as order_id, currency, uom, amount as ordered_amount, quantity as ordered_quantity
 from {{ ref('current_resources') }} where resource_type = 'order'
), payments as (
 select tenant_id, plant_id, order_id, currency, sum(amount) as deposited_amount
 from {{ ref('current_resources') }} where resource_type = 'payment'
 group by tenant_id, plant_id, order_id, currency
), deliveries as (
 select tenant_id, plant_id, order_id, uom, sum(quantity) as fulfilled_quantity
 from {{ ref('current_resources') }} where resource_type = 'fulfillment'
 group by tenant_id, plant_id, order_id, uom
)
select o.*, coalesce(p.deposited_amount, 0)::decimal(38,12) as deposited_amount,
 (o.ordered_amount-coalesce(p.deposited_amount,0))::decimal(38,12) as unpaid_amount,
 coalesce(d.fulfilled_quantity,0)::decimal(38,12) as fulfilled_quantity,
 (o.ordered_quantity-coalesce(d.fulfilled_quantity,0))::decimal(38,12) as remaining_quantity
from orders o left join payments p using(tenant_id,plant_id,order_id,currency)
left join deliveries d using(tenant_id,plant_id,order_id,uom)
