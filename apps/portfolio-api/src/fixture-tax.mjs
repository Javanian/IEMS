export const fixtureVat = policy => policy === 'FIXTURE_VAT_11_V1';
export const minorMoney = s => BigInt(s.replace('.', ''));
export const formatMoney = (n, scale) => {
  const raw = n.toString().padStart(scale + 1, '0');
  return scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}` : raw;
};
export const fixtureTax = net => (net * 22n + 100n) / 200n;
export const taxAmounts = (net, tax, scale) => ({ netAmount: formatMoney(net, scale), taxAmount: formatMoney(tax, scale), grossAmount: formatMoney(net + tax, scale) });
