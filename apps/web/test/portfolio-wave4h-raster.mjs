import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { getDocument } from '../../../packages/document-rendering/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '../../../packages/document-rendering/node_modules/@napi-rs/canvas/index.js';

const directory = resolve(process.argv[2]);
const artifacts = JSON.parse(await readFile(resolve(directory, 'wave4h-vat.json')));
assert.equal(artifacts.length, 4);
await mkdir(resolve(directory, 'vat-raster'), { recursive: true });
const results = [];
for (const artifact of artifacts) {
  const bytes = await readFile(resolve(directory, artifact.filename));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.pdfHash);
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const items = (await page.getTextContent()).items.filter(item => item.str.trim());
    assert.ok(items.length > 10);
    for (const item of items) assert.ok(item.transform[4] >= 40 && item.transform[4] + item.width <= 555 && item.transform[5] > 35 && item.transform[5] < 810, item.str);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
    const filename = `${artifact.kind}-${artifact.issueId}-${number}.png`;
    await writeFile(resolve(directory, 'vat-raster', filename), canvas.toBuffer('image/png'));
    results.push({ filename, items: items.length, pdfHash: artifact.pdfHash });
  }
  await pdf.destroy();
}
await writeFile(resolve(directory, 'vat-raster', 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ artifacts: artifacts.length, pages: results.length, bounds: 'pass', results }));
