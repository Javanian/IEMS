select distinct r.tenant_id,r.plant_id from {{ ref('current_resources') }} r
left join {{ ref('coverage_status') }} c using(tenant_id,plant_id)
where coalesce(c.complete,false)=false
