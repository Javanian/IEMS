'use strict';

const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const ROUTES_DIR = path.join(API_DIR, 'routes');
const SERVER_FILE = path.join(API_DIR, 'server.js');

const WRITE_METHODS = ['post', 'put', 'patch', 'delete'];

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*'));
    })
    .join('\n');
}

function joinPath(prefix, routePath) {
  const head = String(prefix || '').replace(/\/+$/, '');
  const tail = String(routePath || '').trim();
  if (tail === '' || tail === '/') return head || '/';
  const joined = head + (tail.startsWith('/') ? tail : '/' + tail);
  return joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
}

function pad(s, n) {
  const v = String(s);
  return v + ' '.repeat(Math.max(0, n - v.length));
}

function readMounts() {
  const src = stripComments(fs.readFileSync(SERVER_FILE, 'utf8'));
  const mounts = new Map();

  const withPrefix =
    /app\s*\.\s*use\s*\(\s*(['"])([^'"]+)\1\s*,\s*require\s*\(\s*(['"])\.\/routes\/([^'"]+)\3\s*\)/g;
  let m;
  while ((m = withPrefix.exec(src)) !== null) {
    mounts.set(path.basename(m[4], '.js') + '.js', m[2]);
  }

  const noPrefix = /app\s*\.\s*use\s*\(\s*require\s*\(\s*(['"])\.\/routes\/([^'"]+)\1\s*\)/g;
  while ((m = noPrefix.exec(src)) !== null) {
    const key = path.basename(m[2], '.js') + '.js';
    if (!mounts.has(key)) mounts.set(key, '');
  }

  return mounts;
}

function readRoutes(mounts) {
  const files = fs
    .readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
  const routes = [];
  const unmountedFiles = [];
  const suspicious = [];

  for (const file of files) {
    if (!mounts.has(file)) unmountedFiles.push(file);
    const prefix = mounts.has(file) ? mounts.get(file) : null;

    const raw = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const src = stripComments(raw);
    const lines = raw.split(/\r?\n/);

    if (/router\s*\.\s*use\s*\(\s*['"]/.test(src)) {
      suspicious.push(
        `${file}: ada router.use('<prefix>', ...) — prefix bersarang tidak dihitung skrip ini`
      );
    }

    if (/router\s*\.\s*route\s*\(/.test(src)) {
      suspicious.push(`${file}: ada router.route(...) — bentuk ini tidak diparse skrip ini`);
    }

    const dynamic = new RegExp(
      `router\\s*\\.\\s*(?:${WRITE_METHODS.join('|')})\\s*\\(\\s*[^'"\\s]`,
      'g'
    );
    if (dynamic.test(src)) {
      suspicious.push(`${file}: ada router.<method>( dengan path non-literal (backtick/variabel)`);
    }

    const re = new RegExp(
      `router\\s*\\.\\s*(${WRITE_METHODS.join('|')})\\s*\\(\\s*(['"])([^'"]*)\\2`,
      'g'
    );
    let m;
    while ((m = re.exec(src)) !== null) {
      const method = m[1].toUpperCase();
      const routePath = m[3];

      const needle = new RegExp(
        `router\\s*\\.\\s*${m[1]}\\s*\\(\\s*['"]${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`
      );
      const idx = lines.findIndex((l) => needle.test(l));
      routes.push({
        method,
        routePath,
        file,
        line: idx >= 0 ? idx + 1 : null,
        prefix,
        full: prefix === null ? null : joinPath(prefix, routePath),
      });
    }
  }

  return { routes, unmountedFiles, suspicious };
}

function loadMatchers() {
  const guard = require('../rbac/rbacGuard');
  if (
    !guard._test ||
    typeof guard._test.manifestHit !== 'function' ||
    typeof guard._test.allowHit !== 'function'
  ) {
    throw new Error(
      'rbacGuard.js tidak lagi mengekspor _test.{manifestHit,allowHit}. ' +
        'Perbarui skrip ini agar tetap memakai logika pencocokan milik guard, JANGAN menyalinnya.'
    );
  }
  return guard._test;
}

function main() {
  const { MANIFEST, ALLOWLIST } = require('../rbac/manifest');
  const { manifestHit, allowHit } = loadMatchers();

  const mounts = readMounts();
  const { routes, unmountedFiles, suspicious } = readRoutes(mounts);

  const mapped = [];
  const allowed = [];
  const unmapped = [];

  for (const r of routes) {
    if (r.full === null) {
      unmapped.push({ ...r, why: 'file route tidak ter-mount di server.js' });
      continue;
    }
    if (allowHit(r.method, r.full)) {
      allowed.push(r);
      continue;
    }
    const hit = manifestHit(r.method, r.full);
    if (hit) {
      mapped.push({ ...r, hit });
      continue;
    }
    unmapped.push({ ...r, why: 'tidak ada di MANIFEST maupun ALLOWLIST' });
  }

  const usedManifest = new Set(mapped.map((r) => `${r.hit.m} ${r.hit.p}`));
  const deadManifest = MANIFEST.filter((e) => !usedManifest.has(`${e.m} ${e.p}`));

  const out = [];
  out.push('=== check_rbac_manifest — route vs RBAC manifest (A-03) ===');
  out.push(
    `routes/*.js       : ${fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js')).length} file, ${mounts.size} ter-mount di server.js`
  );
  out.push(
    `MANIFEST/ALLOWLIST: ${MANIFEST.length} entri manifest, ${ALLOWLIST.length} entri allowlist`
  );
  out.push('');
  out.push(`Total route non-GET : ${routes.length}`);
  out.push(`  terpetakan        : ${mapped.length}`);
  out.push(`  allow-listed      : ${allowed.length}`);
  out.push(`  TIDAK TERPETAKAN  : ${unmapped.length}`);

  if (unmapped.length) {
    out.push('');
    out.push('TIDAK TERPETAKAN — akan 403 untuk SEMUA role begitu RBAC_ENFORCE=1:');
    for (const r of unmapped) {
      const where = `${r.file}${r.line ? ':' + r.line : ''}`;
      out.push(
        `  ${pad(r.method, 6)} ${pad(r.full || `(${r.routePath})`, 58)} ${pad(where, 34)} ${r.why}`
      );
    }
  }

  if (unmountedFiles.length) {
    out.push('');
    out.push(`CATATAN: file route tanpa app.use() di server.js: ${unmountedFiles.join(', ')}`);
  }

  if (suspicious.length) {
    out.push('');
    out.push('CATATAN: pola route yang tidak terjangkau parser teks (periksa manual):');
    for (const s of suspicious) out.push(`  - ${s}`);
  }

  if (deadManifest.length) {
    out.push('');
    out.push(
      `CATATAN: ${deadManifest.length} entri MANIFEST tidak dicocokkan route mana pun (kemungkinan route sudah dihapus/di-shadow entri yang lebih spesifik):`
    );
    for (const e of deadManifest) out.push(`  ${pad(e.m, 6)} ${pad(e.p, 58)} f=${e.f}`);
  }

  out.push('');
  out.push(
    unmapped.length
      ? `HASIL: GAGAL — ${unmapped.length} write tidak terpetakan.`
      : 'HASIL: BERSIH — semua write terpetakan.'
  );
  console.log(out.join('\n'));

  process.exit(unmapped.length ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error('check_rbac_manifest gagal:', err.message);
  process.exit(1);
}
