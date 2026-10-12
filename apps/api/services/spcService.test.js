'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeImr, parseNumber } = require('./spcService');

const rows = (values) => values.map((value, i) => ({ value, at: i }));

test('center line and limits come from the mean moving range', () => {
  // moving ranges: 2, 2, 2, 2 -> MR̄ = 2, σ̂ = 2 / 1.128
  const result = computeImr(rows([10, 12, 10, 12, 10]));
  const sigma = 2 / 1.128;
  assert.equal(result.n, 5);
  assert.equal(result.stats.mean, 10.8);
  assert.equal(result.stats.mrBar, 2);
  assert.equal(result.stats.sigma, Number(sigma.toFixed(4)));
  assert.equal(result.stats.ucl, Number((10.8 + 3 * sigma).toFixed(4)));
  assert.equal(result.stats.lcl, Number((10.8 - 3 * sigma).toFixed(4)));
  assert.equal(result.stats.mrUcl, Number((3.267 * 2).toFixed(4)));
  assert.equal(result.points[0].movingRange, null);
  assert.equal(result.points[1].movingRange, 2);
});

test('rule 1 flags a point beyond three sigma', () => {
  const values = [10, 10.2, 9.9, 10.1, 9.8, 10, 10.1, 9.9, 10, 25];
  const result = computeImr(rows(values));
  const last = result.points.at(-1);
  assert.ok(last.rules.includes(1));
  assert.ok(result.signals.byRule[1] >= 1);
});

test('rule 2 flags nine points on one side of the center line', () => {
  const values = [5, 5.1, 4.9, 5.2, 4.8, 5.1, 4.9, ...Array(9).fill(0).map((_, i) => 9 + (i % 2) * 0.1), 1, 1.2, 0.9, 1.1, 1, 0.8, 1.1];
  const result = computeImr(rows(values));
  const flagged = result.points.filter((p) => p.rules.includes(2)).map((p) => p.index);
  assert.ok(flagged.length >= 9, `expected a run of 9, got ${flagged}`);
});

test('rule 3 flags six points steadily increasing', () => {
  const values = [5, 4, 5, 4, 1, 2, 3, 4, 5, 6, 5, 4, 5];
  const result = computeImr(rows(values));
  const flagged = result.points.filter((p) => p.rules.includes(3)).map((p) => p.value);
  assert.deepEqual(flagged, [1, 2, 3, 4, 5, 6]);
});

test('capability indices use the estimated sigma', () => {
  const result = computeImr(rows([10, 12, 10, 12, 10]), { lsl: 4, usl: 16 });
  const sigma = 2 / 1.128;
  assert.equal(result.stats.capability.cp, Number((12 / (6 * sigma)).toFixed(3)));
  // USL is closer to the mean (5.2) than LSL (6.8), so Cpk is the upper index.
  assert.equal(result.stats.capability.cpk, Number(((16 - 10.8) / (3 * sigma)).toFixed(3)));
});

test('one-sided specification gives Cpk only', () => {
  const result = computeImr(rows([10, 12, 10, 12, 10]), { usl: 16 });
  assert.equal(result.stats.capability.cp, null);
  assert.ok(result.stats.capability.cpk > 0);
});

test('non-numeric readings are ignored and an empty series is handled', () => {
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('OK'), null);
  assert.equal(parseNumber('1.2.3'), null);
  const result = computeImr(rows(['OK', 'NG', '']));
  assert.equal(result.n, 0);
  assert.equal(result.stats, null);
});

test('a flat series has zero sigma and no signals', () => {
  const result = computeImr(rows([3, 3, 3, 3]));
  assert.equal(result.stats.sigma, 0);
  assert.equal(result.signals.total, 0);
  assert.equal(result.stats.capability, null);
});
