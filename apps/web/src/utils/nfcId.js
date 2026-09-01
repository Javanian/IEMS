const HEX_RE = /^[0-9a-fA-F]+$/;

function looksHex(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  const hasSeparator = /[:\-\s]/.test(s);
  const hasHexLetter = /[a-fA-F]/.test(s);
  if (!hasSeparator && !hasHexLetter) return false;
  const hex = s.replace(/[\s:\-]/g, '');
  return HEX_RE.test(hex) && hex.length % 2 === 0 && hex.length >= 6;
}

function hexToLeDecimal(raw) {
  const hex = String(raw).replace(/[\s:\-]/g, '');
  const bytes = hex.match(/../g) || [];
  return BigInt('0x' + bytes.slice().reverse().join('')).toString();
}

export function normalizeNfcId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (looksHex(s)) return hexToLeDecimal(s);
  if (/^\d+$/.test(s)) return BigInt(s).toString();
  return s;
}

export default normalizeNfcId;
