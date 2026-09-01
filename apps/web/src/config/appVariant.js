import { getConfig } from './loadConfig';

export function getVariant() {
  const v = String(getConfig()?.variant || 'salvaging').toLowerCase();
  return v === 'manufacturing' ? 'manufacturing' : 'salvaging';
}

export function isManufacturing() {
  return getVariant() === 'manufacturing';
}

export function isSalvaging() {
  return !isManufacturing();
}

export function getFeatureFlags() {
  return getConfig()?.feature_flags || {};
}
