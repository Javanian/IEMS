import PDFDocument from 'pdfkit';

export async function renderV3(snapshot) {
 const doc=new PDFDocument({size:'A4',margin:48,bufferPages:true,compress:true,info:{Title:`${snapshot.kind} ${snapshot.sourceId}`,Author:'IEMS',CreationDate:new Date('2000-01-01T00:00:00Z'),ModDate:new Date('2000-01-01T00:00:00Z')}});
 const chunks=[];const result=new Promise((resolve,reject)=>{doc.on('data',x=>chunks.push(x));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const title=snapshot.kind==='purchaseOrder'?'PURCHASE ORDER':snapshot.kind.toUpperCase();
 function header(){
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#153449').text(title,48,48);
  doc.font('Helvetica').fontSize(10).fillColor('#111111').text(`Reference: ${snapshot.sourceId} / revision ${snapshot.sourceVersion}`,48,74,{width:499});
  doc.moveDown(0.5);
 }
 function ensure(height){if(doc.y+height>742){doc.addPage();header();}}
 header();
 for(const k of ['tenantId','legalEntityId','plantId'])doc.fontSize(11).text(`${k}: ${snapshot.scope[k]}`);
 doc.text(`Template: ${snapshot.template.id} v${snapshot.template.version}`);
 if(snapshot.reference)doc.text(`Dispatch reference: ${snapshot.reference}`);
 doc.moveDown();
 for(const [i,line] of snapshot.lines.entries()){
  const rows=[`${i+1}. ${line.description}`,`Quantity: ${line.quantity} ${line.uom}`];
  if(line.currency)rows.push(`Unit price (net): ${line.unitPrice} ${line.currency}`,`Subtotal: ${line.netAmount} | Tax: ${line.taxAmount} | Total: ${line.grossAmount} ${line.currency}`);
  doc.fontSize(12);const height=rows.reduce((sum,row,n)=>sum+doc.font(n===0?'Helvetica-Bold':'Helvetica').heightOfString(row,{width:499}),0)+14;
  ensure(height);
  for(const [n,row] of rows.entries())doc.font(n===0?'Helvetica-Bold':'Helvetica').fontSize(12).text(row,{width:499});
  doc.moveDown(0.8);
 }
 ensure(110);
 doc.font('Helvetica-Bold').fontSize(14).text(`Subtotal: ${snapshot.netAmount} ${snapshot.currency}`).text(`Tax: ${snapshot.taxAmount} ${snapshot.currency}`).text(`Total: ${snapshot.grossAmount} ${snapshot.currency}`);
 doc.font('Helvetica').fontSize(10).text(`Policy: ${snapshot.taxPolicy} / version ${snapshot.taxPolicyVersion} / rate ${snapshot.taxRate}`).text('Fixture policy only; not a statutory tax determination.').text(`Rounding: ${snapshot.roundingPolicy}`);
 if(snapshot.salesOrderId)doc.text(`Sales order: ${snapshot.salesOrderId} / version ${snapshot.salesOrderVersion} / quote revision ${snapshot.quoteRevision}`);

 doc.moveDown().font('Helvetica').fontSize(10).fillColor('#333333').text(`Content SHA-256: ${snapshot.contentHash}`,{width:499});
 const range=doc.bufferedPageRange();
 for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(10).fillColor('#333333').text(`Page ${i+1} of ${range.count}`,48,780,{width:499,align:'right',lineBreak:false});}
 doc.end();return result;
}