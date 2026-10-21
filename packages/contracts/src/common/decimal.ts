/**
 * Canonical Decimal String & Unit/Currency Contracts
 *
 * Implements strict non-floating-point numeric representations across IEMS.
 * All financial amounts, quantities, hours, and rates must be transmitted and
 * validated as exact decimal strings with explicit currency and UOM.
 */

export type DecimalString = string & { readonly __brand: unique symbol };
export type SignedDecimalString = string & { readonly __brand: unique symbol };

export const DECIMAL_REGEX = /^[0-9]+(\.[0-9]+)?$/;
export const SIGNED_DECIMAL_REGEX = /^-?[0-9]+(\.[0-9]+)?$/;

export const ISO_CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'JPY', 'AUD', 'GBP', 'CNY'] as const;
export type CurrencyCode = (typeof ISO_CURRENCIES)[number];

export const STANDARD_UOMS = [
  'EA',
  'SET',
  'KG',
  'G',
  'M',
  'MM',
  'MTR',
  'HR',
  'MIN',
  'L',
  'ML',
  'PCS',
  'BOX',
  'UNIT'
] as const;
export type UnitOfMeasure = (typeof STANDARD_UOMS)[number];

export function isValidDecimal(value: unknown): value is DecimalString {
  return typeof value === 'string' && DECIMAL_REGEX.test(value);
}

export function isValidSignedDecimal(value: unknown): value is SignedDecimalString {
  return typeof value === 'string' && SIGNED_DECIMAL_REGEX.test(value);
}

export function assertValidDecimal(value: unknown, fieldName = 'value'): asserts value is DecimalString {
  if (!isValidDecimal(value)) {
    throw new TypeError(
      `Invalid Decimal: ${fieldName} must be an exact decimal string matching ^[0-9]+(\\.[0-9]+)?$, got ${JSON.stringify(value)}`
    );
  }
}

export function assertValidSignedDecimal(value: unknown, fieldName = 'value'): asserts value is SignedDecimalString {
  if (!isValidSignedDecimal(value)) {
    throw new TypeError(
      `Invalid Signed Decimal: ${fieldName} must be an exact decimal string matching ^-?[0-9]+(\\.[0-9]+)?$, got ${JSON.stringify(value)}`
    );
  }
}

export function compareDecimals(a: string, b: string): number {
  assertValidSignedDecimal(a, 'a');
  assertValidSignedDecimal(b, 'b');

  const negA = a.startsWith('-');
  const negB = b.startsWith('-');
  if (negA && !negB) return -1;
  if (!negA && negB) return 1;

  const absA = negA ? a.slice(1) : a;
  const absB = negB ? b.slice(1) : b;

  const [intA = '0', fracA = ''] = absA.split('.');
  const [intB = '0', fracB = ''] = absB.split('.');

  const maxFrac = Math.max(fracA.length, fracB.length);
  const padFracA = fracA.padEnd(maxFrac, '0');
  const padFracB = fracB.padEnd(maxFrac, '0');

  const maxInt = Math.max(intA.length, intB.length);
  const padIntA = intA.padStart(maxInt, '0');
  const padIntB = intB.padStart(maxInt, '0');

  const normalizedA = padIntA + padFracA;
  const normalizedB = padIntB + padFracB;

  let cmp = 0;
  if (normalizedA < normalizedB) cmp = -1;
  else if (normalizedA > normalizedB) cmp = 1;

  return negA ? -cmp : cmp;
}

export function addDecimals(a: string, b: string): DecimalString {
  assertValidDecimal(a, 'a');
  assertValidDecimal(b, 'b');

  const [intA = '0', fracA = ''] = a.split('.');
  const [intB = '0', fracB = ''] = b.split('.');

  const maxFrac = Math.max(fracA.length, fracB.length);
  const scale = BigInt(10) ** BigInt(maxFrac);

  const bigA = BigInt(intA) * scale + BigInt(fracA.padEnd(maxFrac, '0') || '0');
  const bigB = BigInt(intB) * scale + BigInt(fracB.padEnd(maxFrac, '0') || '0');

  const sum = bigA + bigB;
  const sumStr = sum.toString().padStart(maxFrac + 1, '0');

  if (maxFrac === 0) {
    return sum.toString() as DecimalString;
  }

  const intPart = sumStr.slice(0, sumStr.length - maxFrac);
  const fracPart = sumStr.slice(sumStr.length - maxFrac);

  return `${intPart}.${fracPart}` as DecimalString;
}

export function multiplyDecimalByInteger(dec: string, factor: number | bigint): DecimalString {
  assertValidDecimal(dec, 'dec');
  const bigFactor = BigInt(factor);
  if (bigFactor < 0n) throw new RangeError('Multiplier must be non-negative');

  const [intPart = '0', fracPart = ''] = dec.split('.');
  const fracLen = fracPart.length;

  const rawVal = BigInt(intPart + fracPart);
  const resultBig = rawVal * bigFactor;
  const resStr = resultBig.toString().padStart(fracLen + 1, '0');

  if (fracLen === 0) {
    return resStr as DecimalString;
  }

  const intRes = resStr.slice(0, resStr.length - fracLen);
  const fracRes = resStr.slice(resStr.length - fracLen);
  return `${intRes}.${fracRes}` as DecimalString;
}

export const DecimalSchema = {
  $id: 'https://iems.org/schemas/common/decimal.json',
  type: 'string',
  pattern: '^[0-9]+(\\.[0-9]+)?$',
  description: 'Exact non-negative decimal string (e.g. "1250000.00" or "42"). Floating point numbers are prohibited.'
} as const;

export const SignedDecimalSchema = {
  $id: 'https://iems.org/schemas/common/signed-decimal.json',
  type: 'string',
  pattern: '^-?[0-9]+(\\.[0-9]+)?$',
  description: 'Exact signed decimal string (e.g. "-150.00" or "42"). Floating point numbers are prohibited.'
} as const;

export const CurrencySchema = {
  $id: 'https://iems.org/schemas/common/currency.json',
  type: 'string',
  enum: ISO_CURRENCIES,
  description: 'Standard 3-letter ISO 4217 currency code.'
} as const;

export const UomSchema = {
  $id: 'https://iems.org/schemas/common/uom.json',
  type: 'string',
  enum: STANDARD_UOMS,
  description: 'Standard unit of measure code.'
} as const;
