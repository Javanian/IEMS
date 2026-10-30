select c.event_id from {{ ref('current_resources') }} c
left join {{ ref('current_resources') }} p on p.tenant_id=c.tenant_id and p.plant_id=c.plant_id
 and p.aggregate_id=c.order_id and p.resource_type='order'
where c.resource_type in ('payment','fulfillment')
 and (p.event_id is null or (c.resource_type='payment' and c.currency<>p.currency)
 or (c.resource_type='fulfillment' and c.uom<>p.uom))
