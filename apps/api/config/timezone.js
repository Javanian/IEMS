'use strict';

const DEFAULT_TIMEZONE = 'Asia/Makassar';
const IANA_ZONE = /^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+$/;

function validTz(raw) {
  const s = String(raw || '').trim();
  return IANA_ZONE.test(s) ? s : null;
}

function resolveTimezone() {
  try {
    const { getPlantConfig } = require('./plantConfig');
    const fromConfig = validTz(getPlantConfig().timezone);
    if (fromConfig) return fromConfig;
  } catch (_) {}
  return validTz(process.env.TIMEZONE) || DEFAULT_TIMEZONE;
}

module.exports = { resolveTimezone, DEFAULT_TIMEZONE };
