'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pc = require('./plantConfig');

test('buildConfigFromEnv memetakan env ke config', () => {
  const c = pc.buildConfigFromEnv({
    PLANT_SSB: '5051',
    PLANT_NAME: 'Cikupa',
    APP_VARIANT: 'manufacturing',
    TIMEZONE: 'Asia/Makassar',
    TGT_TABLE: 'ph3_order',
    PLANT_FILTER: '5051',
  });
  assert.equal(c.plant_code, '5051');
  assert.equal(c.plant_name, 'Cikupa');
  assert.equal(c.variant, 'manufacturing');
  assert.equal(c.timezone, 'Asia/Makassar');
  assert.equal(c.order_master_table, 'ph3_order');
  assert.equal(c.plant_filter, '5051');
  assert.equal(c._source, 'env-fallback');
});

test('variant tak dikenal jatuh ke salvaging', () => {
  assert.equal(pc.normalizeVariant('bogus'), 'salvaging');
  assert.equal(pc.normalizeVariant(''), 'salvaging');
  assert.equal(pc.normalizeVariant('manufacturing # comment'), 'manufacturing');
});

test('timezone invalid jatuh ke default', () => {
  assert.equal(pc.safeTimezone('not a zone'), pc.DEFAULT_TIMEZONE);
  assert.equal(pc.safeTimezone('Asia/Jakarta'), 'Asia/Jakarta');
});

test('toPublicSubset tak membocorkan sap_rules/plant_filter/order_master_table', () => {
  const full = pc.parseRow({
    plant_code: '5051',
    plant_name: 'Cikupa',
    variant: 'manufacturing',
    timezone: 'Asia/Makassar',
    order_master_table: 'ph3_order',
    plant_filter: '5051',
    feature_flags: { ms_project: true },
    sap_rules: { zconf: 'secret' },
  });
  const pub = pc.toPublicSubset(full);
  assert.deepEqual(Object.keys(pub).sort(), [
    'feature_flags',
    'plant_code',
    'plant_name',
    'timezone',
    'variant',
  ]);
  assert.equal(pub.sap_rules, undefined);
  assert.equal(pub.plant_filter, undefined);
  assert.equal(pub.order_master_table, undefined);
  assert.deepEqual(pub.feature_flags, { ms_project: true });
});
