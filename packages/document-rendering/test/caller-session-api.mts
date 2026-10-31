import {createIssuer,createSnapshot,type Scope,type IssueAdmission,type PreparedIssue} from '@iems/document-rendering';
import {MongoClient,type ClientSession} from 'mongodb';
const client=new MongoClient('mongodb://127.0.0.1:1');
async function check(session:ClientSession,scope:Scope){
 const issuer=await createIssuer({client,db:client.db('owned_type_only')});
 const snapshot=createSnapshot('quote',scope,{...scope,_id:'q',version:1,snapshot:{currency:'USD',total:'1.00',taxPolicy:'NO_TAX',roundingPolicy:'LINE_HALF_UP',lines:[{description:'Type proof',quantity:'1',unitPrice:'1.00',currency:'USD',uom:'EA'}]}});
 const prepared:PreparedIssue=await issuer.prepare(scope,snapshot);
 const record=await issuer.issueInTransaction({scope,snapshot,prepared,session,admission:async(d:IssueAdmission)=>{const version:number=d.identity.sourceVersion;void version;}});
 await issuer.read(scope,record._id,{session});
 // @ts-expect-error A structural copy without the opaque preparation brand is invalid.
 const forged:PreparedIssue={contentHash:'',pdfHash:'',pdf:Buffer.alloc(0)};
 void forged;
}
void check;
