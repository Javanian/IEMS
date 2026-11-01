import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '../../../apps/web/node_modules/@babel/parser/lib/index.js';

const source=readFileSync(new URL('../../../apps/web/test/portfolio-review-e01-browser.mjs',import.meta.url),'utf8');
let navigation;
function walk(node) {
  if(!node||typeof node!=='object')return;
  if(node.type==='VariableDeclarator'&&node.id.name==='navigate')navigation=source.slice(node.init.start,node.init.end);
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
}
walk(parse(source,{sourceType:'module'}));
assert.ok(navigation);

function harness(condition) {
  const steps=[];
  class Select {
    disabled=false;
    options=[{value:'pick'},{value:'ship'}];
    get value(){return this.selected;}
    set value(value){this.selected=value;steps.push(`value:${value}`);}
    dispatchEvent(event){steps.push(event.type);}
  }
  const select=new Select();
  const document={
    querySelectorAll:selector=>{assert.equal(selector,'label');return [{textContent:'Dispatch stepRecord a pick for packingRecord direct dispatch',querySelector:selector=>{assert.equal(selector,'select');return select;}}];},
    querySelector:selector=>{assert.equal(selector,'form[aria-label="Record shipment"]');return select.value==='ship'&&steps.at(-1)==='change'?{}:null;},
  };
  const context={document,HTMLSelectElement:Select,Event:class {constructor(type){this.type=type;}}};
  const evaluate=expression=>runInNewContext(expression,context);
  const navigate=new Function('call','ready','checked','web',`return (${navigation})`)(
    async(method,{url})=>{assert.equal(method,'Page.navigate');select.selected='pick';steps.push(`navigate:${url}`);},
    async expression=>{assert.ok(evaluate(expression));steps.push(expression===condition?'ready:original':'ready:dispatch');},
    async expression=>{steps.push('evaluate:native-control');return evaluate(expression);},
    'http://127.0.0.1:32400',
  );
  return {navigate,steps};
}

test('each fulfillment navigation selects the native dispatch control before original shipment readiness',async()=>{
  const condition='document.querySelector(\'form[aria-label="Record shipment"]\')',h=harness(condition);
  for(const id of ['order-one','order-two']){
    await h.navigate(`fulfillment/orders/${id}`,condition);
    assert.deepEqual(h.steps.splice(0),[`navigate:http://127.0.0.1:32400/portfolio/fulfillment/orders/${id}`,'ready:dispatch','evaluate:native-control','value:ship','input','change','ready:original']);
  }
});

test('other routes preserve navigation followed immediately by their original condition',async()=>{
  const condition='true',h=harness(condition);
  await h.navigate('accounts',condition);
  assert.deepEqual(h.steps,['navigate:http://127.0.0.1:32400/portfolio/accounts','ready:original']);
});
