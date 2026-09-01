
export const AREA_OPTIONS = [
  { areaCode: 'AREA-01', areaName: 'Area 1',  bays: ['A38', 'A37', 'A36', 'A35'] },
  { areaCode: 'AREA-02', areaName: 'Area 2',  bays: ['A34', 'A33', 'A32'] },
  { areaCode: 'AREA-03', areaName: 'Area 3',  bays: ['A30', 'A29', 'A28', 'A27'] },
  { areaCode: 'AREA-04', areaName: 'Area 4',  bays: ['A26', 'A25', 'A24', 'A23'] },
  { areaCode: 'AREA-05', areaName: 'Area 5',  bays: ['A22', 'A21', 'A20', 'A19'] },
  { areaCode: 'AREA-06', areaName: 'Area 6',  bays: ['A18', 'A17', 'A16', 'A15'] },
  { areaCode: 'AREA-07', areaName: 'Area 7',  bays: ['A14', 'A13', 'A12', 'A11'] },
  { areaCode: 'AREA-08', areaName: 'Area 8',  bays: ['A9', 'A8', 'A7', 'A6'] },
  { areaCode: 'AREA-09', areaName: 'Area 9',  bays: ['A5', 'A4', 'A3', 'A2'] },
  { areaCode: 'AREA-10', areaName: 'Area 10', bays: ['A1'] },
  { areaCode: 'AREA-11', areaName: 'Area 11', bays: ['B38', 'B37', 'B36', 'B35'] },
  { areaCode: 'AREA-12', areaName: 'Area 12', bays: ['B34', 'B33', 'B32'] },
  { areaCode: 'AREA-13', areaName: 'Area 13', bays: ['B30', 'B29', 'B28', 'B27'] },
  { areaCode: 'AREA-14', areaName: 'Area 14', bays: ['B26', 'B25', 'B24', 'B23'] },
  { areaCode: 'AREA-15', areaName: 'Area 15', bays: ['B22', 'B21', 'B20', 'B19'] },
  { areaCode: 'AREA-16', areaName: 'Area 16', bays: ['B17', 'B16', 'B15', 'B14'] },
  { areaCode: 'AREA-17', areaName: 'Area 17', bays: ['B13', 'B12', 'B11', 'B10'] },
  { areaCode: 'AREA-18', areaName: 'Blasting & Painting', bays: ['PT1', 'PT2', 'PT3', 'BL1', 'BL2'] },
];

export const BLASTING_AREA_CODE = 'AREA-18';

export function areaRangeLabel(area) {
  if (!area) return '';
  if (area.areaCode === BLASTING_AREA_CODE) return area.areaName || 'Blasting & Painting';
  const bays = Array.isArray(area.bays) ? area.bays : [];
  if (bays.length === 0) return area.areaName || area.areaCode || '';
  if (bays.length === 1) return bays[0];
  return `${bays[0]}-${bays[bays.length - 1]}`;
}

export const BAY_ZONES = [
  { key: 'EDGE', suffix: 'E', label: 'Edge' },
  { key: 'CENTER', suffix: 'C', label: 'Center' },
];

export const ZONE_BY_KEY = BAY_ZONES.reduce((acc, zone) => {
  acc[zone.key] = zone;
  return acc;
}, {});

export function isZonedArea(areaCode) {
  return areaCode !== BLASTING_AREA_CODE;
}

export function bayCode(base, zoneKey) {
  const zone = ZONE_BY_KEY[zoneKey];
  return zone ? `${base}${zone.suffix}` : base;
}

export function splitBayCode(code) {
  const text = String(code || '').trim().toUpperCase();
  const match = /^([A-Z]{1,3}[0-9]{1,3})([CE])$/.exec(text);
  if (!match) return { base: text, zoneKey: null };
  const zone = BAY_ZONES.find((z) => z.suffix === match[2]);
  return { base: match[1], zoneKey: zone ? zone.key : null };
}

export function bayLabel(code) {
  const { base, zoneKey } = splitBayCode(code);
  return zoneKey ? `${base} ${ZONE_BY_KEY[zoneKey].label}` : base;
}

export function zoneOrderFor(laneLabel) {
  return laneLabel === 'bottom' ? ['CENTER', 'EDGE'] : ['EDGE', 'CENTER'];
}

export function bayCodesOf(areaCode) {
  const area = MANUFACTURING_AREAS[areaCode];
  if (!area) return [];
  if (!isZonedArea(areaCode)) return [...area.bays];
  return area.bays.flatMap((base) => BAY_ZONES.map((zone) => bayCode(base, zone.key)));
}

export const MANUFACTURING_AREAS = AREA_OPTIONS.reduce((acc, { areaCode, areaName, bays }) => {
  acc[areaCode] = { areaName, bays };
  return acc;
}, {});

export const ALL_BAY_CODES = AREA_OPTIONS.flatMap((area) => bayCodesOf(area.areaCode));

export function areaDef(code) {
  const area = MANUFACTURING_AREAS[code];
  if (!area) return null;
  return { areaCode: code, areaName: area.areaName, bays: area.bays, zoned: isZonedArea(code) };
}
