with payments as (
 select tenant_id,plant_id,order_id,currency,sum(amount) as deposited_amount
 from {{ ref('current_resources') }} where resource_type='payment'
 group by tenant_id,plant_id,order_id,currency
), quantities as (
 select tenant_id,plant_id,order_id,
 to_json(list(struct_pack(uom:=uom,ordered_quantity:=cast(ordered_quantity as varchar),
 fulfilled_quantity:=cast(fulfilled_quantity as varchar),remaining_quantity:=cast(remaining_quantity as varchar)) order by uom)) as quantities
 from {{ ref('order_quantity_balances') }} group by tenant_id,plant_id,order_id
)
select o.tenant_id,o.plant_id,o.aggregate_id as order_id,o.currency,o.amount as ordered_amount,
 case when c.complete then coalesce(p.deposited_amount,0) end::decimal(38,12) as deposited_amount,
 case when c.complete then o.amount-coalesce(p.deposited_amount,0) end::decimal(38,12) as unpaid_amount,
 q.quantities,case when c.complete then 'COMPLETE' else 'INCOMPLETE' end as coverage_status
from {{ ref('current_resources') }} o
left join payments p on (p.tenant_id,p.plant_id,p.order_id,p.currency)=(o.tenant_id,o.plant_id,o.aggregate_id,o.currency)
left join quantities q on (q.tenant_id,q.plant_id,q.order_id)=(o.tenant_id,o.plant_id,o.aggregate_id)
left join {{ ref('coverage_status') }} c on (c.tenant_id,c.plant_id)=(o.tenant_id,o.plant_id)
where o.resource_type='order'
