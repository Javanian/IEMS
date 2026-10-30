select event_id from {{ ref('resource_history') }}
where resource_type not in ('order','payment','fulfillment','telemetry') or resource_type is null
 or occurred_at > received_at or received_at > available_at
 or (valid_to is not null and valid_to < valid_from)
 or (resource_type in ('order','payment') and (amount is null or amount < 0 or currency is null))
 or (resource_type in ('order','fulfillment') and (quantity is null or quantity < 0 or uom is null))
 or (resource_type in ('payment','fulfillment') and order_id is null)
