{{ config(materialized='incremental', unique_key='event_id', incremental_strategy='delete+insert') }}
select event_id, tenant_id, plant_id, aggregate_id, aggregate_version,
       cast(occurred_at as timestamptz) as occurred_at,
       cast(received_at as timestamptz) as received_at,
       cast(available_at as timestamptz) as available_at,
       checksum, cast(envelope as json) as envelope
from {{ source('raw', 'raw_events') }}
{% if is_incremental() %}
where event_id not in (select event_id from {{ this }})
{% endif %}
