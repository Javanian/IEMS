import { createSnapshot, renderPdf, createIssuer, type Scope, type QuotedSource } from '@iems/document-rendering';
import { MongoClient } from 'mongodb';
const scope: Scope = { tenantId: 't', legalEntityId: 'e', plantId: 'p' };
const source: QuotedSource = { _id:'q', version:1, ...scope, snapshot: { currency:'USD', total:'1.00', taxPolicy:'NO_TAX', roundingPolicy:'LINE_HALF_UP', lines:[{ description:'Seal', quantity:'1',unitPrice:'1.00',currency:'USD',uom:'EA' }] } };
const snapshot = createSnapshot('quote',scope,source);
const bytes: Promise<Buffer> = renderPdf(snapshot);
const client = new MongoClient('mongodb://127.0.0.1:1');
async function typecheck() { const issuer=await createIssuer({client,db:client.db('owned_example')}); const record=await issuer.issue(scope,snapshot); await issuer.read(scope,record._id); }
const cumulative = createSnapshot('invoice',scope,{...scope,_id:'i',version:1,currency:'USD',taxPolicy:'NO_TAX',roundingPolicy:'CUMULATIVE_HALF_UP',total:'0.00',lines:[{description:'Split',quantity:'0.5',uom:'EA',currency:'USD',unitPrice:'0.01',amount:'0.00',rounding:{sourceId:'so',lineIndex:0,beforeQuantity:'0.5',afterQuantity:'1',beforeAmount:'0.01',afterAmount:'0.01'}}]});
const provenance: string | undefined = cumulative.lines[0].rounding?.beforeAmount;
void provenance; void bytes; void typecheck;
// @ts-expect-error Decimal numbers are not accepted.
createSnapshot('shipment', scope, { ...scope, _id:'s',version:1,salesOrderId:'so',lineIndex:0,reference:'r',uom:'EA',quantity:1 });
