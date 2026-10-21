import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDecimal,
  isValidSignedDecimal,
  assertValidDecimal,
  assertValidSignedDecimal,
  compareDecimals,
  addDecimals,
  multiplyDecimalByInteger,
  ISO_CURRENCIES,
  STANDARD_UOMS
} from '../src/common/decimal.js';

test('DecimalString validation - valid positive representations', () => {
  const validCases = ['0', '1', '42', '0.00', '1250000.50', '0.000001', '999999999999999999.9999'];
  for (const val of validCases) {
    assert.strictEqual(isValidDecimal(val), true, `Expected valid: ${val}`);
    assert.doesNotThrow(() => assertValidDecimal(val));
  }
});

test('DecimalString validation - invalid representations rejected', () => {
  const invalidCases = [
    '',
    ' ',
    'abc',
    '-10.50', // negative not allowed for unsigned DecimalString
    '12.', // trailing dot
    '.45', // leading dot without 0
    '1,000.00', // comma
    '1e5', // scientific notation
    'NaN',
    'Infinity',
    null,
    undefined,
    123.45, // native float prohibited
    100
  ];

  for (const val of invalidCases) {
    assert.strictEqual(isValidDecimal(val), false, `Expected invalid: ${String(val)}`);
    assert.throws(() => assertValidDecimal(val));
  }
});

test('SignedDecimalString validation - allows negative and positive', () => {
  assert.strictEqual(isValidSignedDecimal('-150.00'), true);
  assert.strictEqual(isValidSignedDecimal('150.00'), true);
  assert.strictEqual(isValidSignedDecimal('0'), true);
  assert.strictEqual(isValidSignedDecimal('-0.05'), true);

  assert.strictEqual(isValidSignedDecimal('1e-5'), false);
  assert.strictEqual(isValidSignedDecimal('--5.0'), false);
  assert.doesNotThrow(() => assertValidSignedDecimal('-42.00'));
});

test('compareDecimals - exact decimal string comparison', () => {
  assert.strictEqual(compareDecimals('10.50', '10.5'), 0);
  assert.strictEqual(compareDecimals('10.500', '10.5'), 0);
  assert.strictEqual(compareDecimals('10.51', '10.50'), 1);
  assert.strictEqual(compareDecimals('10.49', '10.50'), -1);
  assert.strictEqual(compareDecimals('100.0', '99.999'), 1);
  assert.strictEqual(compareDecimals('-10.0', '5.0'), -1);
  assert.strictEqual(compareDecimals('5.0', '-10.0'), 1);
  assert.strictEqual(compareDecimals('-5.0', '-10.0'), 1);
  assert.strictEqual(compareDecimals('-10.0', '-5.0'), -1);
});

test('addDecimals - precision arithmetic without float rounding drift', () => {
  assert.strictEqual(addDecimals('0.1', '0.2'), '0.3');
  assert.strictEqual(addDecimals('100.25', '50.75'), '151.00');
  assert.strictEqual(addDecimals('1250000.50', '250000.75'), '1500001.25');
  assert.strictEqual(addDecimals('10', '20'), '30');
});

test('multiplyDecimalByInteger - exact multiplication', () => {
  assert.strictEqual(multiplyDecimalByInteger('10.25', 4), '41.00');
  assert.strictEqual(multiplyDecimalByInteger('0.005', 10), '0.050');
  assert.strictEqual(multiplyDecimalByInteger('100', 3), '300');
});

test('Currencies and UOM constants', () => {
  assert.ok(ISO_CURRENCIES.includes('IDR'));
  assert.ok(ISO_CURRENCIES.includes('USD'));
  assert.ok(ISO_CURRENCIES.includes('EUR'));

  assert.ok(STANDARD_UOMS.includes('EA'));
  assert.ok(STANDARD_UOMS.includes('SET'));
  assert.ok(STANDARD_UOMS.includes('KG'));
  assert.ok(STANDARD_UOMS.includes('HR'));
});
