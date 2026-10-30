import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDecimals, multiplyDecimalByInteger, addDecimals } from '../contracts/dist/src/common/decimal.js';

test('signed zero and padded decimals preserve numeric ordering', () => {
  for (const a of ['-0', '-000.000', '0', '00.00']) {
    for (const b of ['-0', '0.000']) assert.equal(compareDecimals(a, b), 0);
    assert.equal(compareDecimals(a, '-0.001'), 1);
    assert.equal(compareDecimals(a, '0.001'), -1);
  }
  assert.equal(compareDecimals('-0002.30', '-2.3000'), 0);
  assert.equal(compareDecimals('9007199254740993', '9007199254740992'), 1);
});

test('integer multiplication rejects already imprecise numeric inputs', () => {
  for (const factor of [Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, Infinity, '2', null]) {
    assert.throws(() => multiplyDecimalByInteger('0.01', factor), RangeError);
  }
  assert.equal(multiplyDecimalByInteger('0.01', 9007199254740993n), '90071992547409.93');
  assert.equal(addDecimals('9007199254740993.99', '0.01'), '9007199254740994.00');
});
