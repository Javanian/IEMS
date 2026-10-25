export async function boundedQueueMap(rows,read,{signal,concurrency=4}={}) {
  const result=new Array(rows.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,rows.length)},async()=>{
    while(next<rows.length){signal?.throwIfAborted();const index=next++;result[index]=await read(rows[index]);}
  }));
  return result;
}
export async function operationalQueueEvidence(kind,rows,request,{signal,canReadExecution=false}={}) {
  return boundedQueueMap(rows,async row=>{
    if(kind==='delivery' && row.status==='SHIPPED'){
      const response=await request(`/api/deliveries/shipments/${row._id}`,{signal});
      return {...row,delivery:response.data};
    }
    if(kind==='planning' && canReadExecution && row.status==='PLANNED' && row.engineering.status==='APPROVED_DEMAND'){
      const response=await request(`/api/internal-execution/orders?internalOrderId=${encodeURIComponent(row._id)}&limit=1`,{signal});
      return {...row,executionRead:true,existingExecution:response.data[0] || null};
    }
    return row;
  },{signal});
}
export function planningQueueAction(row) {
  if(row.status!=='PLANNED')return null;
  if(row.engineering.status!=='APPROVED_DEMAND')return 'Complete and approve engineering';
  if(row.existingExecution)return null;
  if(!row.executionRead)return 'Review approved demand with a production operator';
  if(!row.planningReady)return 'Review current planning source restrictions';
  return 'Start an internal production job';
}
export function deliveryQueueAction(row) {
  if(row.status!=='SHIPPED' || !row.delivery || row.delivery.status==='DELIVERED')return null;
  return row.delivery.canConfirm===true ? 'Confirm the remaining customer delivery' : 'Review delivery evidence and confirmation restrictions';
}
