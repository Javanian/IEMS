'use strict';

const IANA_ZONE = /^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+$/;
const DEFAULT_TIMEZONE = 'Asia/Makassar';
const VALID_VARIANTS = ['salvaging', 'manufacturing'];

function normalizeVariant(raw) {
  const v = String(raw || '')
    .split('#')[0]
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  return VALID_VARIANTS.includes(v) ? v : 'salvaging';
}

function safeTimezone(raw) {
  const tz = String(raw || '').trim();
  return IANA_ZONE.test(tz) ? tz : DEFAULT_TIMEZONE;
}

function buildConfigFromEnv(env) {
  const e = env || {};
  const flags = {};
  const variant = normalizeVariant(e.APP_VARIANT);
  return {
    plant_code: String(e.PLANT_SSB || '').trim() || 'unknown',
    plant_name: String(e.PLANT_NAME || '').trim() || String(e.PLANT_SSB || 'unknown').trim(),
    variant,
    timezone: safeTimezone(e.TIMEZONE),
    order_master_table: String(e.TGT_TABLE || 'ph3_order').trim(),
    plant_filter: e.PLANT_FILTER ? String(e.PLANT_FILTER).trim() : null,
    feature_flags: flags,
    sap_rules: {},
    _source: 'env-fallback',
  };
}

function parseRow(row) {
  return {
    plant_code: row.plant_code,
    plant_name: row.plant_name,
    variant: normalizeVariant(row.variant),
    timezone: safeTimezone(row.timezone),
    order_master_table: row.order_master_table || 'ph3_order',
    plant_filter: row.plant_filter || null,
    feature_flags: row.feature_flags || {},
    sap_rules: row.sap_rules || {},
    _source: 'db',
  };
}

function toPublicSubset(config) {
  return {
    plant_code: config.plant_code,
    plant_name: config.plant_name,
    variant: config.variant,
    timezone: config.timezone,
    feature_flags: config.feature_flags || {},
  };
}

let cached = null;

async function loadPlantConfig(db) {
  try {
    const result = await db.query('SELECT * FROM public.plant_config WHERE id = 1 LIMIT 1');
    if (result.rows && result.rows.length > 0) {
      cached = parseRow(result.rows[0]);
    } else {
      cached = buildConfigFromEnv(process.env);
      console.warn(
        '[plantConfig] baris plant_config tak ada — pakai fallback env ' +
          `(variant=${cached.variant}). Seed via scripts/seed_plant_config.js.`
      );
    }
  } catch (err) {
    cached = buildConfigFromEnv(process.env);
    console.warn(`[plantConfig] gagal baca plant_config (${err.message}) — pakai fallback env.`);
  }
  console.log(
    `[plantConfig] loaded: plant=${cached.plant_code} variant=${cached.variant} ` +
      `tz=${cached.timezone} source=${cached._source}`
  );
  return cached;
}

function getPlantConfig() {
  if (!cached) throw new Error('plantConfig belum dimuat — panggil loadPlantConfig(db) dulu');
  return cached;
}

function getPublicConfig() {
  return toPublicSubset(getPlantConfig());
}

async function reloadPlantConfig(db) {
  return loadPlantConfig(db);
}

module.exports = {
  buildConfigFromEnv,
  parseRow,
  toPublicSubset,
  normalizeVariant,
  safeTimezone,
  loadPlantConfig,
  getPlantConfig,
  getPublicConfig,
  reloadPlantConfig,
  DEFAULT_TIMEZONE,
  VALID_VARIANTS,
};
