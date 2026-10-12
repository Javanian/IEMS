// Fails when a component uses a raw hex color in a Tailwind class (e.g. bg-[#0077b6]).
// Colors come from the tokens in tailwind.config.js; see design-system/iems/MASTER.md.
// ALLOWED lists the few one-off status shades that have no token on purpose.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set(['#047857', '#050b16', '#079949', '#bbf7d0', '#eefaf4']);
const PATTERN = /\b[a-z:-]+-\[(#[0-9a-fA-F]{3,8})\]/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(jsx?|tsx?)$/.test(name)) yield path;
  }
}

const violations = [];
for (const file of files('src')) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [match, hex] of line.matchAll(PATTERN)) {
        if (!ALLOWED.has(hex.toLowerCase())) violations.push(`${file}:${i + 1}  ${match}`);
      }
    });
}

if (violations.length) {
  console.error(`Raw hex colors in classes (use design tokens instead):\n${violations.join('\n')}`);
  process.exit(1);
}
console.log('Design tokens: no raw hex colors in classes.');
