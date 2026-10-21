/**
 * Test Suite: Mathematical Balance, Decimal Precision, and Entity Lineage Verification
 * Uses Node.js native test runner (node:test, node:assert).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  masterData,
  e01ManufacturingFixture,
  e02RepairFixture,
  validation
} = require('../index');

test('Global Integrity, Precision, and Lineage Suite', async (t) => {
  await t.test('Decimal precision adherence in E01 fixture', () => {
    const res = validation.validateDecimalPrecision(e01ManufacturingFixture);
    assert.equal(res.valid, true, `Precision errors: ${res.errors.join('; ')}`);
    assert.equal(res.errors.length, 0);
  });

  await t.test('Decimal precision adherence in E02 fixture', () => {
    const res = validation.validateDecimalPrecision(e02RepairFixture);
    assert.equal(res.valid, true, `Precision errors: ${res.errors.join('; ')}`);
    assert.equal(res.errors.length, 0);
  });

  await t.test('Mathematical balance in E01 manufacturing lifecycle', () => {
    const res = validation.validateE01Balance(e01ManufacturingFixture);
    assert.equal(res.valid, true, `Balance errors: ${res.errors.join('; ')}`);
    assert.equal(res.errors.length, 0);
  });

  await t.test('Mathematical balance in E02 repair and rejection lifecycle', () => {
    const res = validation.validateE02Balance(e02RepairFixture);
    assert.equal(res.valid, true, `Balance errors: ${res.errors.join('; ')}`);
    assert.equal(res.errors.length, 0);
  });

  await t.test('Foreign key, plant scope, and entity lineage integrity', () => {
    const res = validation.validateEntityLineage(e01ManufacturingFixture, e02RepairFixture, masterData);
    assert.equal(res.valid, true, `Lineage errors: ${res.errors.join('; ')}`);
    assert.equal(res.errors.length, 0);
  });
});
