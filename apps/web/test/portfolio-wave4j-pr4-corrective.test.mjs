import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

test('actual inquiry create form supports quoteEditor known account IDs without a CRM lookup', async () => {
  const result = await build({
    stdin: { contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { MemoryRouter } from 'react-router-dom';
      import { NewInquiry } from '../src/features/portfolio/InquiryWorkspace.jsx';
      import { IdentityContext, calls } from '../src/features/portfolio/PortfolioWorkspace.jsx';
      export function render(permissions) {
        calls.length = 0;
        const html = renderToStaticMarkup(React.createElement(MemoryRouter, null,
          React.createElement(IdentityContext.Provider, {value: {permissions}}, React.createElement(NewInquiry))));
        return {html, calls: [...calls]};
      }`, resolveDir: fileURLToPath(new URL('./', import.meta.url)), loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'inquiry-resource-fixture', setup(bundler) {
      bundler.onResolve({ filter: /PortfolioWorkspace\.jsx$/ }, () => ({ path: 'inquiry-resources', namespace: 'fixture' }));
      bundler.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        import React from 'react';
        export const IdentityContext = React.createContext(null);
        export const calls = [];
        export function useResource(path, allPages) {
          calls.push({path, allPages});
          return {data: [{_id: 'known-account', name: 'Synthetic customer'}]};
        }
        export function Resource({resource, children}) { return children(resource); }
        export function Failure() { return null; }
      `, resolveDir: fileURLToPath(new URL('../', import.meta.url)) }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const fixture = module.exports;
  const editor = fixture.render(['quote.read', 'quote.write']);
  assert.match(editor.html, /Known customer account ID<input required="" name="accountId"/);
  assert.match(editor.html, /Your role cannot browse customer accounts/);
  assert.doesNotMatch(editor.html, /<select name="accountId"/);
  assert.deepEqual(editor.calls, []);
  assert.doesNotMatch(editor.html, /<fieldset disabled/);

  const crmEditor = fixture.render(['quote.read', 'quote.write', 'crm.read']);
  assert.match(crmEditor.html, /Customer account<select name="accountId" required=""/);
  assert.match(crmEditor.html, /value="known-account"/);
  assert.deepEqual(crmEditor.calls, [{path: '/api/crm/accounts?limit=100', allPages: true}]);
  assert.doesNotMatch(crmEditor.html, /Known customer account ID/);
});
