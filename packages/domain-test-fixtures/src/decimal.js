/**
 * Deterministic fixed-point decimal arithmetic for IEMS domain models.
 * Operates on string representations to prevent IEEE-754 floating point inaccuracies.
 * Supports arbitrary scale arithmetic with BigInt internally.
 */

'use strict';

/**
 * Normalizes input string or number to a standard decimal string representation.
 * @param {string|number|bigint} val
 * @returns {string}
 */
function toDecimalString(val) {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Invalid decimal string: "${val}"`);
    }
    return trimmed;
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new Error(`Cannot convert non-finite number to decimal: ${val}`);
    }
    return val.toString();
  }
  if (typeof val === 'bigint') {
    return val.toString();
  }
  throw new Error(`Unsupported type for decimal conversion: ${typeof val}`);
}

/**
 * Parses a decimal string into { sign: 1n | -1n, intPart: string, fracPart: string }
 */
function splitDecimal(valStr) {
  let str = toDecimalString(valStr);
  let sign = 1n;
  if (str.startsWith('-')) {
    sign = -1n;
    str = str.slice(1);
  } else if (str.startsWith('+')) {
    str = str.slice(1);
  }
  const parts = str.split('.');
  const intPart = parts[0] || '0';
  const fracPart = parts[1] || '';
  return { sign, intPart, fracPart };
}

/**
 * Converts decimal string to BigInt scaled by given scale factor (10^scale).
 * @param {string|number|bigint} val
 * @param {number} targetScale
 * @returns {bigint}
 */
function toScaledBigInt(val, targetScale) {
  const { sign, intPart, fracPart } = splitDecimal(val);
  const paddedFrac = (fracPart + '0'.repeat(targetScale)).slice(0, targetScale);
  const combinedStr = intPart + paddedFrac;
  const rawBigInt = BigInt(combinedStr);
  return sign < 0n ? -rawBigInt : rawBigInt;
}

/**
 * Converts scaled BigInt back to decimal string with exact scale.
 * @param {bigint} scaled
 * @param {number} targetScale
 * @returns {string}
 */
function fromScaledBigInt(scaled, targetScale) {
  const sign = scaled < 0n ? '-' : '';
  let absVal = scaled < 0n ? -scaled : scaled;
  const divisor = 10n ** BigInt(targetScale);
  const intPart = absVal / divisor;
  const fracPart = absVal % divisor;

  if (targetScale === 0) {
    return `${sign}${intPart.toString()}`;
  }

  const paddedFrac = fracPart.toString().padStart(targetScale, '0');
  return `${sign}${intPart.toString()}.${paddedFrac}`;
}

/**
 * Add two decimal values with specified scale (defaults to max scale of inputs or 4).
 */
function add(a, b, scale = 4) {
  const bigA = toScaledBigInt(a, scale);
  const bigB = toScaledBigInt(b, scale);
  return fromScaledBigInt(bigA + bigB, scale);
}

/**
 * Subtract b from a (a - b) with specified scale.
 */
function sub(a, b, scale = 4) {
  const bigA = toScaledBigInt(a, scale);
  const bigB = toScaledBigInt(b, scale);
  return fromScaledBigInt(bigA - bigB, scale);
}

/**
 * Multiply two decimal values. Result rounded or scaled to target scale.
 */
function mul(a, b, scale = 2) {
  const workingScale = 8;
  const bigA = toScaledBigInt(a, workingScale);
  const bigB = toScaledBigInt(b, workingScale);
  const product = (bigA * bigB) / (10n ** BigInt(workingScale));

  // Now scale down from workingScale to target scale with half-up rounding
  const diff = workingScale - scale;
  if (diff > 0) {
    const roundFactor = 10n ** BigInt(diff);
    const half = roundFactor / 2n;
    const isNegative = product < 0n;
    const absProduct = isNegative ? -product : product;
    const roundedAbs = (absProduct + half) / roundFactor;
    const finalScaled = isNegative ? -roundedAbs : roundedAbs;
    return fromScaledBigInt(finalScaled, scale);
  }
  return fromScaledBigInt(product, scale);
}

/**
 * Divide a by b with specified scale and half-up rounding.
 */
function div(a, b, scale = 4) {
  const workingScale = scale + 4;
  const bigA = toScaledBigInt(a, workingScale);
  const bigB = toScaledBigInt(b, workingScale);
  if (bigB === 0n) {
    throw new Error('Division by zero');
  }
  const scaledNumerator = bigA * (10n ** BigInt(workingScale));
  const quotient = scaledNumerator / bigB;

  // Round to target scale
  const diff = workingScale - scale;
  const roundFactor = 10n ** BigInt(diff);
  const half = roundFactor / 2n;
  const isNegative = quotient < 0n;
  const absQuotient = isNegative ? -quotient : quotient;
  const roundedAbs = (absQuotient + half) / roundFactor;
  const finalScaled = isNegative ? -roundedAbs : roundedAbs;
  return fromScaledBigInt(finalScaled, scale);
}

/**
 * Compare two decimals:
 * returns -1 if a < b, 0 if a === b, 1 if a > b
 */
function cmp(a, b, scale = 6) {
  const bigA = toScaledBigInt(a, scale);
  const bigB = toScaledBigInt(b, scale);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

function eq(a, b, scale = 4) {
  return cmp(a, b, scale) === 0;
}

function lt(a, b, scale = 4) {
  return cmp(a, b, scale) < 0;
}

function lte(a, b, scale = 4) {
  return cmp(a, b, scale) <= 0;
}

function gt(a, b, scale = 4) {
  return cmp(a, b, scale) > 0;
}

function gte(a, b, scale = 4) {
  return cmp(a, b, scale) >= 0;
}

/**
 * Formats a decimal string to an exact fixed scale (e.g. 2 for currency, 4 for quantity).
 */
function format(val, scale = 2) {
  const big = toScaledBigInt(val, scale);
  return fromScaledBigInt(big, scale);
}

module.exports = {
  toDecimalString,
  toScaledBigInt,
  fromScaledBigInt,
  add,
  sub,
  mul,
  div,
  cmp,
  eq,
  lt,
  lte,
  gt,
  gte,
  format
};
