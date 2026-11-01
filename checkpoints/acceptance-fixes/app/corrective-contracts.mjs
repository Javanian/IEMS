import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../apps/web/node_modules/@babel/parser/lib/index.js';

const root=fileURLToPath(new URL('../../../',import.meta.url)),base='9269ae5d504378ecf7bdaae0edf963b893afcc96';
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=path=>readFileSync(new URL(path,new URL('../../../',import.meta.url)),'utf8');
function inventory(source){
  const assertions=[],cases=[];
  function walk(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'){
      const expression=source.slice(node.start,node.end);
      if(/^assert(?:\.|\[|\()/.test(expression))assertions.push(expression);
      if(node.callee.type==='Identifier'&&node.callee.name==='test')cases.push(node.arguments[0].value);
      assert.ok(!(node.callee.type==='MemberExpression'&&node.callee.object.name==='test'&&['skip','only'].includes(node.callee.property.name)),'No skipped or exclusive cases');
    }
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
  }
  walk(parse(source,{sourceType:'module',plugins:['jsx']}));return {assertions,cases};
}
const names=['portfolio-client.test.mjs','portfolio-purchased-fulfillment.test.mjs','portfolio-repair.test.mjs','portfolio-wave3e-documents.test.mjs','portfolio-repair-browser.mjs','portfolio-company-stock-browser.mjs','portfolio-purchased-fulfillment-browser.mjs'];
const comparisons=names.map(name=>{
  const path=`apps/web/test/${name}`,original=execFileSync('git',['show',`${base}:${path}`],{cwd:root,encoding:'utf8'}),current=read(path),before=inventory(original),after=inventory(current);
  for(const name of before.cases)assert.ok(after.cases.includes(name),`Missing original case ${name}`);
  const unmatched=[...after.assertions],removed=[];
  for(const expression of before.assertions){const i=unmatched.indexOf(expression);if(i<0)removed.push(expression);else unmatched.splice(i,1);}
  if(name==='portfolio-company-stock-browser.mjs')assert.deepEqual(removed,[],'All original terminal/company assertions must remain exact');
  return {path,originalSha256:hash(original),currentSha256:hash(current),originalCases:before.cases,currentCases:after.cases,originalAssertions:before.assertions.length,currentAssertions:after.assertions.length,removedOrReconciledExpressions:removed,addedExpressions:unmatched};
});
const e01='apps/web/test/portfolio-review-e01-browser.mjs';assert.equal(hash(read(e01)),hash(execFileSync('git',['show',`${base}:${e01}`],{cwd:root})),'E01 unchanged');
const sources=[
  'apps/portfolio-api/src/repair-return.mjs','apps/portfolio-api/src/repair.mjs','apps/portfolio-api/src/repair-orders.mjs','apps/portfolio-api/src/fixture-tax.mjs',
  'apps/portfolio-api/src/delivery.mjs','apps/portfolio-api/src/internal-execution.mjs','apps/portfolio-api/src/internal-execution-state.mjs','apps/portfolio-api/src/company-stock.mjs',
  'apps/portfolio-api/test/company-stock-use.test.mjs','packages/contracts/src/domains/planning-execution/manufactured-graph.mjs',
  'apps/web/src/features/portfolio/client.mjs','apps/web/src/features/portfolio/purchased-fulfillment.mjs','apps/web/src/features/portfolio/PurchasedFulfillmentUi.jsx',
  'apps/web/src/features/portfolio/repair.mjs','apps/web/src/features/portfolio/RepairWorkspace.jsx','apps/web/src/features/portfolio/ProcurementWorkspace.jsx',
].map(path=>({path,sha256:hash(read(path))}));
const changed=execFileSync('git',['diff','--name-only',base],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
const allowed=new Set([...names.map(name=>`apps/web/test/${name}`),'apps/web/src/features/portfolio/FulfillmentWorkspace.jsx','apps/web/src/features/portfolio/operator.mjs','apps/web/src/features/portfolio/AnalyticsWorkspace.jsx']);
for(const path of changed)assert.ok(allowed.has(path)||path.startsWith('checkpoints/acceptance-fixes/app/'),`Outside exact scope ${path}`);
const result={base,testedSource:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),changed,e01Unchanged:true,originalCasesRetained:true,skipsOrExclusiveCases:false,comparisons,authoritativeSourceHashes:sources,limits:'Syntax and mechanical inventory only. Changed expressions require the explicit source/semantic rationale in CORRECTIVE-RESULT.md. No native browser/Mongo execution.'};
writeFileSync(new URL('./evidence/corrective/assertion-semantic-inventory.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({casesRetained:true,e01Unchanged:true,companyAssertionsExact:true,files:comparisons.length,changedExpressionCounts:comparisons.map(row=>({path:row.path,changed:row.removedOrReconciledExpressions.length,added:row.addedExpressions.length}))}));
