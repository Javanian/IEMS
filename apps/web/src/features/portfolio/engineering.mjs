export function engineeringContent(values, operations, materials, receipts) {
  return {
    operations: Array.from({length:operations}, (_,i)=>({code:values[`code${i}`],instruction:values[`instruction${i}`]})),
    materials: Array.from({length:materials}, (_,i)=>({receiptId:values[`receiptId${i}`],quantityPerUnit:values[`quantityPerUnit${i}`],uom:receipts.find(r=>r._id===values[`receiptId${i}`])?.uom})),
  };
}
export function engineeringDraft(order, values, content, key) {
  const lineIndex=Number(values.lineIndex);
  return {expectedVersion:1,idempotencyKey:key,salesOrderId:order._id,salesOrderVersion:order.version,lineIndex,uom:order.snapshot.lines[lineIndex].uom,...content};
}
export function engineeringTransition(head,key,reason) {
  return {expectedVersion:head.version,idempotencyKey:key,revision:head.currentRevision,...(reason===undefined?{}:{reason})};
}
export function engineeringRelease(wo,head,key) {
  return {expectedVersion:wo.version,idempotencyKey:key,engineeringId:head._id,engineeringVersion:head.version,revision:head.currentRevision};
}
