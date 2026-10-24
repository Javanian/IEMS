import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
test('mounted CRM entry preserves legacy boot and has a dedicated cookie API proxy', async () => {
  const router = await read('../src/router/index.jsx');
  assert.match(router, /path: '\/portfolio\/\*'/);
  const main = await read('../src/main.jsx');
  assert.match(main, /portfolio/);
  assert.match(main, /loadConfig\(\)/);
  const vite = await read('../vite.config.js');
  assert.match(vite, /'\/portfolio-api'/);
  assert.match(vite, /4313/);
  const page = await read('../src/pages/PORTFOLIO/PortfolioPage.jsx');
  assert.match(page, /PortfolioWorkspace/);
});
