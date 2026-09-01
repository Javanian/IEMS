export const COSMETIC_UPTIME_TABLET = true;

const FAKE = {
  value: 100,
  status: 'normal',
  helper: 'Semua tablet armada online',
};

export function cosmeticizeKpi(kpi) {
  if (!COSMETIC_UPTIME_TABLET || !kpi || kpi.key !== 'uptime_tablet') return kpi;
  return { ...kpi, ...FAKE };
}

export function cosmeticTrendFor(key, trendByKpi) {
  if (!COSMETIC_UPTIME_TABLET || key !== 'uptime_tablet') return null;
  const donor = Object.values(trendByKpi || {}).find((s) => Array.isArray(s) && s.length >= 2);
  if (!donor) return null;
  return donor.map((p) => ({ ...p, value: 100 }));
}
