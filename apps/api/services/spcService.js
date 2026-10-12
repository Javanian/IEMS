'use strict';

/**
 * Statistical process control for process-control measurements.
 *
 * Measurements arrive one at a time (one reading per job), so the chart is an
 * individuals and moving-range (I-MR) chart:
 *
 *   center line   x̄  = mean of the readings
 *   sigma         σ̂  = MR̄ / d2, where MR̄ is the mean moving range and d2 = 1.128 (n = 2)
 *   I chart       UCL/LCL = x̄ ± 3σ̂
 *   MR chart      UCL = D4 · MR̄ with D4 = 3.267, LCL = 0
 *
 * Estimating σ from moving ranges instead of the overall standard deviation keeps the
 * limits tight when the process drifts, which is exactly when the chart must react.
 *
 * Out-of-control signals follow the first three Nelson rules:
 *   1  one point beyond 3σ̂
 *   2  nine points in a row on the same side of the center line
 *   3  six points in a row steadily increasing or decreasing
 */

const D2 = 1.128;
const D4 = 3.267;
const RUN_LENGTH = 9;
const TREND_LENGTH = 6;

const round = (value, digits = 4) =>
  value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sampleStdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

function parseNumber(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function nelsonViolations(values, center, ucl, lcl) {
  const rules = values.map(() => []);

  values.forEach((v, i) => {
    if (v > ucl || v < lcl) rules[i].push(1);
  });

  let runSide = 0;
  let runStart = 0;
  values.forEach((v, i) => {
    const side = v > center ? 1 : v < center ? -1 : 0;
    if (side === 0 || side !== runSide) {
      runSide = side;
      runStart = i;
    }
    if (side !== 0 && i - runStart + 1 >= RUN_LENGTH) {
      for (let j = runStart; j <= i; j += 1) if (!rules[j].includes(2)) rules[j].push(2);
    }
  });

  let trendDir = 0;
  let trendStart = 0;
  for (let i = 1; i < values.length; i += 1) {
    const dir = values[i] > values[i - 1] ? 1 : values[i] < values[i - 1] ? -1 : 0;
    if (dir === 0 || dir !== trendDir) {
      trendDir = dir;
      trendStart = i - 1;
    }
    if (dir !== 0 && i - trendStart + 1 >= TREND_LENGTH) {
      for (let j = trendStart; j <= i; j += 1) if (!rules[j].includes(3)) rules[j].push(3);
    }
  }

  return rules;
}

function capability(center, sigma, lsl, usl) {
  if (!(sigma > 0) || (lsl == null && usl == null)) return null;
  const cpu = usl != null ? (usl - center) / (3 * sigma) : null;
  const cpl = lsl != null ? (center - lsl) / (3 * sigma) : null;
  const cp = lsl != null && usl != null ? (usl - lsl) / (6 * sigma) : null;
  const cpk = Math.min(...[cpu, cpl].filter((v) => v != null));
  return { lsl, usl, cp: round(cp, 3), cpk: round(cpk, 3) };
}

/**
 * @param {Array<{value: any}>} rows readings in time order; extra fields are kept
 * @param {{lsl?: number|null, usl?: number|null}} spec optional specification limits
 */
function computeImr(rows, spec = {}) {
  const points = [];
  for (const row of rows) {
    const value = parseNumber(row.value);
    if (value != null) points.push({ ...row, value });
  }
  const values = points.map((p) => p.value);
  const n = values.length;

  if (n === 0) {
    return { n: 0, points: [], stats: null, signals: { total: 0, byRule: { 1: 0, 2: 0, 3: 0 } } };
  }

  const movingRanges = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const mrBar = movingRanges.length ? mean(movingRanges) : 0;
  const center = mean(values);
  // A perfectly flat series has MR̄ = 0; fall back to the sample deviation (also 0).
  const sigma = mrBar > 0 ? mrBar / D2 : sampleStdDev(values);
  const ucl = center + 3 * sigma;
  const lcl = center - 3 * sigma;
  const rules = nelsonViolations(values, center, ucl, lcl);

  const byRule = { 1: 0, 2: 0, 3: 0 };
  const out = points.map((p, i) => {
    for (const r of rules[i]) byRule[r] += 1;
    return {
      ...p,
      index: i + 1,
      movingRange: i === 0 ? null : round(movingRanges[i - 1]),
      rules: rules[i],
      outOfControl: rules[i].length > 0,
    };
  });

  return {
    n,
    points: out,
    stats: {
      mean: round(center),
      sigma: round(sigma),
      stdDev: round(sampleStdDev(values)),
      ucl: round(ucl),
      lcl: round(lcl),
      mrBar: round(mrBar),
      mrUcl: round(D4 * mrBar),
      min: round(Math.min(...values)),
      max: round(Math.max(...values)),
      capability: capability(center, sigma, spec.lsl ?? null, spec.usl ?? null),
    },
    signals: { total: out.filter((p) => p.outOfControl).length, byRule },
  };
}

module.exports = { computeImr, parseNumber, D2, D4 };
