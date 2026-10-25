export const catalogQuoteSchema='CATALOG_QUOTE_V1';
export function catalogQuoteOptions({q='',cursor=''}={}) { return `/api/commercial/catalog-items?q=${encodeURIComponent(q.trim().slice(0,80))}&limit=25${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`; }
export function capturedQuoteItem(line) { return line?.catalogBinding?.itemSnapshot || null; }
export function quoteItemValidity(selected,current,kind) {
  if(!kind)return {valid:false,reason:'Choose the catalog item kind.'};
  if(!selected?._id)return {valid:false,reason:'Choose an approved catalog item.'};
  if(!current || current._id!==selected._id)return {valid:false,reason:'Checking the selected item. Keep its captured revision until the current check completes.'};
  if(current.eligible!==true || current.content?.kind!==kind)return {valid:false,reason:'This item is no longer eligible for the chosen kind. Choose a current approved item.'};
  if(!Number.isSafeInteger(selected.version)||selected.version<1||!Number.isSafeInteger(selected.currentRevision)||selected.currentRevision<1)return {valid:false,reason:'The captured item authority is incomplete. Choose the item again.'};
  if(selected.version!==current.version||selected.currentRevision!==current.currentRevision)return {valid:false,reason:'The selected item revision changed. Review and explicitly use the current approved revision, or choose another item.'};
  return {valid:true,reason:''};
}
export function catalogQuoteContent(values,bindings,key,quote) {
  if(quote&&quote.schema!==catalogQuoteSchema)throw Object.assign(Error('This quotation cannot be upgraded to a catalog quotation.'),{status:400,code:'INVALID_CATALOG_ITEM'});
  if(!bindings.length||bindings.length>100||bindings.some(item=>!item?._id||!item.content?.uom||!Number.isSafeInteger(item.version)||item.version<1||!Number.isSafeInteger(item.currentRevision)||item.currentRevision<1))throw Object.assign(Error('Choose an approved item for every line.'),{status:400,code:'INVALID_CATALOG_ITEM'});
  return {schema:catalogQuoteSchema,...(quote?{expectedVersion:quote.version}:{accountId:values.accountId}),expiresAt:values.expiresAt,taxPolicy:values.taxPolicy||'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:bindings.map((item,i)=>({description:values[`description${i}`],quantity:values[`quantity${i}`],uom:item.content.uom,unitPrice:values[`unitPrice${i}`],currency:values[`currency${i}`],catalogItem:{itemId:item._id,itemVersion:item.version,itemRevision:item.currentRevision}})),idempotencyKey:key};
}
export function catalogQuoteTransition(quote,key) {return {expectedVersion:quote.version,revision:quote.revisions.at(-1).number,idempotencyKey:key};}
export function catalogQuoteHint(error) {
  return ({QUOTE_ITEM_CHANGED:'The item definition changed. Discard this command, review the current approved item, then explicitly select its revision.',ITEM_UOM_MISMATCH:'The line UOM must match the selected item. Review the captured item before submitting.',SERIAL_QUANTITY_REQUIRED:'Enter a whole quantity for a serial-tracked item.',QUOTE_SOURCE_INVALID:'Stored quotation identity evidence is inconsistent. Ask an authorized reviewer to investigate; do not recreate the order.',CATALOG_SEARCH_SOURCE_INVALID:'The catalog search evidence is inconsistent. Refresh or ask an authorized reviewer to check the item.',MASTER_SOURCE_INVALID:'The selected item evidence is inconsistent. Refresh or ask an authorized reviewer to check the item.',REVISION_CONFLICT:'This quotation has reached its revision limit. Review its history before creating another quotation.'})[error?.code] || '';
}
