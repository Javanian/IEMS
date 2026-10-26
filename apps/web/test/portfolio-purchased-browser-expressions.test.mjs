import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse,parseExpression } from '@babel/parser';
import { runInNewContext } from 'node:vm';

test('purchased native browser compiles decoded static readiness/evaluation expressions before runtime',async()=>{
  const source=await readFile(new URL('./portfolio-purchased-fulfillment-browser.mjs',import.meta.url),'utf8'),ast=parse(source,{sourceType:'module'}),failures=[];
  let checked=0;
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&['ready','checked'].includes(node.callee.name)){
      const argument=node.arguments[0],expression=argument?.type==='StringLiteral'?argument.value:argument?.type==='TemplateLiteral'&&!argument.expressions.length?argument.quasis.map(part=>part.value.cooked).join(''):null;
      if(expression!==null){checked++;try{parseExpression(expression);}catch(error){failures.push({line:node.loc.start.line,expression,message:error.message});}}
    }
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  }
  visit(ast);assert.ok(checked>0,'Actual decoded expression strings were inspected');assert.deepEqual(failures,[]);
});

test('actual forbidden commercial-link expression queries the exact selector and cannot hide a present link',async()=>{
  const source=await readFile(new URL('./portfolio-purchased-fulfillment-browser.mjs',import.meta.url),'utf8'),ast=parse(source,{sourceType:'module'}),argumentsFound=[];
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='checked'){
      const argument=node.arguments[0];
      if(argument&&source.slice(argument.start,argument.end).includes('#purchased-fulfillment a[href*'))argumentsFound.push(argument);
    }
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  }
  visit(ast);assert.equal(argumentsFound.length,1);
  const argument=argumentsFound[0],expression=runInNewContext(source.slice(argument.start,argument.end),{js:JSON.stringify},{timeout:1000});
  parseExpression(expression);
  const evaluate=(mounted,match)=>{
    const queried=[],document={body:mounted?{}:null,querySelector(selector){queried.push(selector);return mounted&&match?{tagName:'A'}:null;}};
    const result=runInNewContext(expression,{document},{timeout:1000});
    assert.deepEqual(queried,['#purchased-fulfillment a[href*="/orders/"]']);
    return result;
  };
  assert.equal(evaluate(true,true),true);
  assert.equal(evaluate(true,false),false);
  assert.equal(evaluate(false,false),false);
  assert.throws(()=>assert.equal(evaluate(true,true),false),{code:'ERR_ASSERTION'},'The permission assertion must fail when a forbidden link is present');
});

test('revocation readiness recognizes the actual purchased read fallback and rejects authorized, missing or unrelated UI',async()=>{
  const source=await readFile(new URL('./portfolio-purchased-fulfillment-browser.mjs',import.meta.url),'utf8'),ui=await readFile(new URL('../src/features/portfolio/PurchasedFulfillmentUi.jsx',import.meta.url),'utf8'),ast=parse(source,{sourceType:'module'}),uiAst=parse(ui,{sourceType:'module',plugins:['jsx']}),argumentsFound=[];
  function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(child=>walk(child,visit));else if(value&&typeof value==='object')walk(value,visit);}
  walk(ast,node=>{if(node.type!=='CallExpression'||node.callee.type!=='Identifier'||node.callee.name!=='ready')return;const argument=node.arguments[0],raw=argument&&source.slice(argument.start,argument.end);if(raw?.includes('#portfolio-content')&&(raw.includes('Access denied')||raw.includes('Purchased stock fulfillment')))argumentsFound.push(argument);});
  assert.equal(argumentsFound.length,1,'Inspect the actual revocation ready call');
  let denial,heading;
  walk(uiAst,node=>{
    if(node.type!=='FunctionDeclaration')return;
    if(node.id.name==='Read')walk(node,element=>{if(element.type==='JSXElement'&&element.openingElement.name.name==='p'&&element.openingElement.attributes.some(attribute=>attribute.name?.name==='className'&&attribute.value?.value==='pf-disabled-reason'))denial=element.children.filter(child=>child.type==='JSXText').map(child=>child.value).join('').trim();});
    if(node.id.name==='PurchasedFulfillmentOrder')walk(node,element=>{if(element.type==='JSXElement'&&element.openingElement.name.name==='h1')heading=element.children.filter(child=>child.type==='JSXText').map(child=>child.value).join('').trim();});
  });
  assert.equal(denial,'You need permission to read fulfillment and catalog stock to review purchased order fulfillment.');assert.equal(heading,'Purchased stock fulfillment');
  const orderId='semantic-order',argument=argumentsFound[0],expression=runInNewContext(source.slice(argument.start,argument.end),{js:JSON.stringify,orderId},{timeout:1000});parseExpression(expression);
  const evaluate=(state={})=>{
    const root={querySelector(selector){if(selector===':scope > h1')return {textContent:state.heading??heading};if(selector===':scope > .pf-disabled-reason')return state.authorized?null:{textContent:state.reason??denial};if(selector==='#purchased-fulfillment, form')return state.authorized||state.businessForm?{}:null;throw Error(`Unexpected root selector ${selector}`);},querySelectorAll(selector){assert.equal(selector,'[role="status"]');return state.loading?[{textContent:'Loading...'}]:[];}};
    const document={querySelector(selector){if(selector==='#portfolio-content')return state.missing?null:root;if(selector==='#portfolio-content > .pf-error')return state.genericError?{innerText:'Access denied'}:null;throw Error(`Unexpected document selector ${selector}`);}};
    return runInNewContext(expression,{document,location:{pathname:state.pathname??`/portfolio/fulfillment/orders/${orderId}`,search:state.search??'?catalog=1'},URLSearchParams},{timeout:1000});
  };
  assert.equal(evaluate(),true,'The actual purchased Read permission fallback must be recognized');
  for(const state of [{authorized:true},{missing:true},{genericError:true,reason:'Unrelated warehouse denial'},{heading:'Another workspace'},{pathname:'/portfolio/fulfillment/orders/another-order'},{search:'?catalog=0'},{businessForm:true},{loading:true}])assert.equal(Boolean(evaluate(state)),false,JSON.stringify(state));
});
