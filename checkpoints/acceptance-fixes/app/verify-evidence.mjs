import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../apps/web/node_modules/@babel/parser/lib/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url)), evidence = new URL('./evidence/', import.meta.url);
const base = '010ec3b4e826d05b7e1f191286da042fe5a2bd42', hash = value => createHash('sha256').update(value).digest('hex');
const unchanged = ['apps/web/src/features/portfolio/CommercialWorkspace.jsx'].map(path => {
  const original = execFileSync('git',['show',`${base}:${path}`],{cwd:root}), current=readFileSync(new URL(path,new URL('../../../',import.meta.url)));
  assert.equal(hash(current),hash(original)); return {path,sha256:hash(current),unchanged:true};
});
function assertions(source) {
  const result=[];
  function walk(node) {
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression' && /^assert(?:\.|\[|\()/.test(source.slice(node.start,node.end)))result.push(source.slice(node.start,node.end));
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
  }
  walk(parse(source,{sourceType:'module'})); return result;
}
const runnerPath='apps/web/test/portfolio-review-e01-browser.mjs';
const originalRunner=execFileSync('git',['show',`${base}:${runnerPath}`],{cwd:root,encoding:'utf8'});
const currentRunner=readFileSync(new URL(runnerPath,new URL('../../../',import.meta.url)),'utf8');
function navigation(source) {
  let found;
  function walk(node) {
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclarator'&&node.id.name==='navigate')found=node.init;
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
  }
  walk(parse(source,{sourceType:'module'}));assert.ok(found);return found;
}
const originalNavigation=navigation(originalRunner),currentNavigation=navigation(currentRunner);
assert.equal(currentRunner.slice(0,currentNavigation.start)+originalRunner.slice(originalNavigation.start,originalNavigation.end)+currentRunner.slice(currentNavigation.end),originalRunner,'Only the navigate helper may change');
assert.deepEqual(assertions(currentRunner),assertions(originalRunner),'All original assertion calls and expectations must remain exact and ordered');
const runner={path:runnerPath,originalSha256:hash(originalRunner),currentSha256:hash(currentRunner),assertionCount:assertions(originalRunner).length,allAssertionsExact:true,onlyNavigationHelperChanged:true,fixturesClocksAndOriginalSelectorsExact:true};
const retained=[];
for(const folder of readdirSync(evidence,{withFileTypes:true}).filter(entry=>entry.isDirectory())) {
  for(const name of ['portfolio-browser.mjs','portfolio-review-e01-browser.mjs']) {
    const originalURL=new URL(`${folder.name}/${name}.original`,evidence), adaptedURL=new URL(`${folder.name}/${name}.adapted`,evidence);
    if(!existsSync(originalURL)||!existsSync(adaptedURL))continue;
    const original=readFileSync(originalURL,'utf8'),adapted=readFileSync(adaptedURL,'utf8');
    const expected=assertions(original).map(value=>value.replaceAll('http://127.0.0.1:4313','http://127.0.0.1:32401'));
    const actual=assertions(adapted);
    for(const expression of expected)assert.ok(actual.includes(expression),`${folder.name}/${name}: removed assertion ${expression}`);
    retained.push({folder:folder.name,name,originalAssertions:expected.length,retained:true,originalSha256:hash(original),adaptedSha256:hash(adapted)});
  }
}
assert.ok(retained.some(row=>row.name==='portfolio-review-e01-browser.mjs'));
writeFileSync(new URL('runner-assertion-retention.json',evidence),JSON.stringify({base,unchanged,runner,retainedHistoricalHarnesses:retained},null,2));
console.log(JSON.stringify({unchanged:unchanged.length,runner,retainedHistoricalHarnesses:retained.length,result:'PASS'}));
