'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..', '..', '..');
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

function variantFromEnv() {
  const v = String(process.env.VITE_APP_VARIANT || process.env.APP_VARIANT || 'salvaging')
    .split('#')[0]
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  return ['salvaging', 'manufacturing'].includes(v) ? v : 'salvaging';
}

async function main() {
  const variant = variantFromEnv();
  const plantCode = String(process.env.PLANT_SSB || '').trim();
  if (!plantCode) throw new Error('PLANT_SSB wajib ada di .env untuk seed plant_config');
  const plantName = String(process.env.PLANT_NAME || plantCode).trim();
  const timezone = String(process.env.TIMEZONE || 'Asia/Makassar').trim();
  const tgtTable = String(process.env.TGT_TABLE || 'ph3_order').trim();
  const plantFilter = process.env.PLANT_FILTER ? String(process.env.PLANT_FILTER).trim() : null;
  const featureFlags = { ews: true, machine_hours: true, ms_project: variant === 'manufacturing' };

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'ptssb',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    application_name: 'seed-plant-config',
  });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO public.plant_config
         (id, plant_code, plant_name, variant, timezone, order_master_table, plant_filter, feature_flags, updated_by, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7::jsonb, 'seed-script', now())
       ON CONFLICT (id) DO UPDATE SET
         plant_code = EXCLUDED.plant_code, plant_name = EXCLUDED.plant_name,
         variant = EXCLUDED.variant, timezone = EXCLUDED.timezone,
         order_master_table = EXCLUDED.order_master_table, plant_filter = EXCLUDED.plant_filter,
         feature_flags = EXCLUDED.feature_flags, updated_by = 'seed-script', updated_at = now()`,
      [plantCode, plantName, variant, timezone, tgtTable, plantFilter, JSON.stringify(featureFlags)]
    );
    const { rows } = await client.query(
      'SELECT plant_code, plant_name, variant, timezone FROM public.plant_config WHERE id = 1'
    );
    console.log('plant_config seeded:', rows[0]);
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error('seed gagal:', e.message);
  process.exitCode = 1;
});
