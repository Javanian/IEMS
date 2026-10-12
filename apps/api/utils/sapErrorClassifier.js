const RULES = [
  {
    key: 'needs_storno',
    label: 'Needs storno in SAP first',
    action:
      'The earlier confirmation for this segment is already in SAP. Storno it in SAP before sending this correction.',
    test: (t) => /storno|source_key (berbeda|differ)|already ?post|sudah ter-?post/i.test(t),
  },
  {
    key: 'burned_zid',
    label: 'ZTIMESHEETID reused',
    action:
      'This number was already accepted by SAP (sequence reset). Storno in SAP or shift the sequence.',
    test: (t) =>
      /already (accepted|received) by sap|reused|terpakai ulang|sudah pernah diterima|ztimesheetid \d+ (already|sudah)/i.test(
        t
      ),
  },
  {
    key: 'network',
    label: 'Network error to SAP',
    action: 'Usually transient — retry. If it repeats, check connectivity to SAP CPI.',
    test: (t) =>
      /ssl|unexpected_eof|urlopen|timed? ?out|connection (reset|refused|aborted)|max retries|eof occurred|getaddrinfo|handshake/i.test(
        t
      ),
  },
  {
    key: 'order_lock',
    label: 'Order being processed by SAP (lock)',
    action:
      'SAP locks an order while confirming it. Retry shortly — posting is already serial per order.',
    test: (t) =>
      /already being processed|being processed by|is locked|sapci|gesperrt|lock/i.test(t),
  },
  {
    key: 'pernr_missing',
    label: 'Personnel number (PERNR) not in SAP HR',
    action:
      'The employee is not registered in SAP HR master, or the PERNR is wrong. Fix on the SAP HR side (not MPS2).',
    test: (t) =>
      /personnel master record.*not found|pernr.*not found|personalnummer.*nicht|personnel number.*not/i.test(
        t
      ),
  },
  {
    key: 'order_teco',
    label: 'Order is TECO / closed in SAP',
    action:
      'The order is technically complete (TECO) — SAP rejects new confirmations. Revoke TECO in SAP, or ignore if truly done.',
    test: (t) =>
      /user status teco|status teco|teco is active|technically complete|order.*(closed|clsd)|systemstatus.*(teco|clsd)/i.test(
        t
      ),
  },
  {
    key: 'workcenter_missing',
    label: 'Work center missing in SAP master',
    action:
      'SAP master data: this work center is not registered in the plant. Fix on the SAP side.',
    test: (t) =>
      /work ?cent(er|re).*(does not exist|not.*plant|tidak ada)|arbeitsplatz.*nicht/i.test(t),
  },
  {
    key: 'cost_center',
    label: 'Cost center / activity type not set',
    action: 'Non-M1/M2 rows need a cost center in SAP master. Fix on the SAP side.',
    test: (t) => /cost ?cent(er|re)|kostenstelle|activity type only in conjunction/i.test(t),
  },
  {
    key: 'period_closed',
    label: 'SAP posting period closed',
    action: 'The work date falls in a period SAP has closed. Open the period or check the date.',
    test: (t) => /posting period|period.*not open|buchungsperiode|posting date/i.test(t),
  },
  {
    key: 'duplicate',
    label: 'Rejected by SAP as duplicate',
    action:
      'SAP considers this confirmation already present. Check whether it posted; storno to resend.',
    test: (t) =>
      /already exist|duplicate|been posted|confirmation.*exist|bereits vorhanden/i.test(t),
  },
];

const UNKNOWN = {
  key: 'other',
  label: 'Other',
  action: 'Not yet recognized — open the detail to see the full SAP message.',
};

function classifySapError(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return { key: 'none', label: '-', action: null, message: '' };
  }

  const firstLine =
    text
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim()
      .slice(0, 240) || text.slice(0, 240);

  for (const rule of RULES) {
    if (rule.test(text)) {
      return { key: rule.key, label: rule.label, action: rule.action, message: firstLine };
    }
  }
  return {
    key: UNKNOWN.key,
    label: firstLine || UNKNOWN.label,
    action: UNKNOWN.action,
    message: firstLine,
  };
}

module.exports = { classifySapError };
