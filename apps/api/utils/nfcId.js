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

function normalizeNfcId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (looksHex(s)) return hexToLeDecimal(s);
  if (/^\d+$/.test(s)) return BigInt(s).toString();
  return s;
}

function nfcIdVariants(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const out = new Set([s]);

  if (looksHex(s)) {
    const hex = s.replace(/[\s:\-]/g, '');
    const bytes = hex.match(/../g) || [];
    out.add(hex.toLowerCase());
    out.add(hex.toUpperCase());
    out.add(bytes.join(':').toLowerCase());
    out.add(bytes.join(':').toUpperCase());
    out.add(hexToLeDecimal(s));
  } else if (/^\d+$/.test(s)) {
    const n = BigInt(s);
    const bare = n.toString();
    out.add(bare);

    for (let w = bare.length + 1; w <= 12; w++) out.add(bare.padStart(w, '0'));

    const hex = bare === '0' ? '00000000' : n.toString(16).padStart(8, '0');
    const bytes = (hex.match(/../g) || []).reverse();
    out.add(bytes.join(':').toLowerCase());
    out.add(bytes.join(':').toUpperCase());
    out.add(bytes.join('').toLowerCase());
    out.add(bytes.join('').toUpperCase());
  }

  return [...out].filter(Boolean);
}

module.exports = { normalizeNfcId, nfcIdVariants, looksHex };
