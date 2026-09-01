"use strict";




















const pool = global.pool || require("../db");
const { reloadPlantConfig } = require("../config/plantConfig");


const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEGACY_KEYS = ["va", "nnva", "nva"];
const LEGACY_DEFAULT = 90;


const NOT_STAGED_STATUSIDS = [0, 3, 4];
const STATUS_CATEGORY_OVERRIDES = { 2: "nnva", 10: "nva" };

const DEFAULT_RULES = {
  break_windows: [
    { start: "12:00", end: "13:00", days: [1, 2, 3, 4, 5, 6, 0] },
    { start: "00:00", end: "01:00", days: [1, 2, 3, 4, 5] },
    { start: "18:30", end: "19:00", days: [6, 0] },
    { start: "22:00", end: "22:30", days: [6, 0] },
  ],
  max_record_minutes: { mch: {}, timesheet: {} },
};

function parseMinutes(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function categoryOfActivityType(activitytype) {
  const at = String(activitytype || "").trim().toUpperCase();
  if (at === "M1") return "va";
  if (at === "M2") return "nnva";
  return "nva";
}




function normalizeTypeMap(raw, keyRe) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key);
    if (!keyRe.test(k)) continue;
    if (value === null) {
      out[k] = null;
      continue;
    }
    const minutes = parseMinutes(value);
    if (minutes !== null) out[k] = minutes;
  }
  return out;
}




function legacyCategoryMinutes(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const present = LEGACY_KEYS.filter((k) => raw[k] !== undefined && raw[k] !== null);
    if (present.length === 0) return null;
    const out = {};
    for (const key of LEGACY_KEYS) out[key] = parseMinutes(raw[key]) ?? LEGACY_DEFAULT;
    return out;
  }
  const minutes = parseMinutes(raw);
  if (minutes === null) return null;
  return { va: minutes, nnva: minutes, nva: minutes };
}

function normalizeMaxRecordMinutes(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    mch: normalizeTypeMap(src.mch, /^\d+$/),
    timesheet: normalizeTypeMap(src.timesheet, /^\d*$/),
  };
}



function expandLegacyIntoTypeMaps(maxRecord, legacy, catalog) {
  if (!legacy || !catalog) return maxRecord;
  const mch = { ...maxRecord.mch };
  const timesheet = { ...maxRecord.timesheet };
  for (const row of catalog.mch || []) {
    const key = String(row.statusid);
    if (!(key in mch)) mch[key] = legacy[row.category] ?? LEGACY_DEFAULT;
  }
  for (const row of catalog.timesheet || []) {
    const key = String(row.activitytype ?? "");
    if (!(key in timesheet)) timesheet[key] = legacy[row.category] ?? LEGACY_DEFAULT;
  }
  return { mch, timesheet };
}

function normalizeRules(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const windows = Array.isArray(src.break_windows)
    ? src.break_windows
        .filter((w) => w && TIME_RE.test(String(w.start || "")) && TIME_RE.test(String(w.end || "")))
        .map((w) => ({
          start: String(w.start),
          end: String(w.end),
          days: Array.isArray(w.days)
            ? [...new Set(w.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
            : [],
        }))
        .filter((w) => w.days.length > 0)
    : [];
  return {
    break_windows: windows,
    max_record_minutes: normalizeMaxRecordMinutes(src.max_record_minutes),
  };
}



async function loadActivityCatalog(db = pool) {
  const mchRes = await db.query(
    "SELECT statusid, description, activitytype FROM public.mch_statustypes ORDER BY statusid"
  );
  const mch = mchRes.rows.map((r) => ({
    statusid: Number(r.statusid),
    description: r.description || "",
    activitytype: r.activitytype || "",
    category: STATUS_CATEGORY_OVERRIDES[Number(r.statusid)] || categoryOfActivityType(r.activitytype),
    staged: !NOT_STAGED_STATUSIDS.includes(Number(r.statusid)),
  }));

  let refRows = [];
  try {
    const tsRes = await db.query(
      "SELECT activitytype, description FROM ews.activity_type_ref ORDER BY activitytype"
    );
    refRows = tsRes.rows;
  } catch (err) {
    console.error("loadActivityCatalog: ews.activity_type_ref tidak terbaca:", err.message);
  }
  const timesheet = [
    { activitytype: "", description: "Productive (order work)", category: "va", staged: true },
    ...refRows.map((r) => ({
      activitytype: String(r.activitytype || "").trim(),
      description: r.description || "",
      category: "nva",
      staged: true,
    })),
  ];
  return { mch, timesheet };
}


async function getConfigRules(req, res) {
  try {
    const result = await pool.query("SELECT sap_rules FROM public.plant_config WHERE id = 1 LIMIT 1");
    const raw = result.rows[0]?.sap_rules || {};
    const rules = normalizeRules(raw);
    const legacy = legacyCategoryMinutes(raw.max_record_minutes);
    let migrated_from_legacy = false;
    if (legacy) {
      const catalog = await loadActivityCatalog().catch(() => null);
      if (catalog) {
        rules.max_record_minutes = expandLegacyIntoTypeMaps(rules.max_record_minutes, legacy, catalog);
        migrated_from_legacy = true;
      }
    }
    res.json({
      data: rules,
      meta: { generated_at: new Date().toISOString(), migrated_from_legacy },
    });
  } catch (err) {
    console.error("getConfigRules error:", err);
    res.status(500).json({ error: err.message });
  }
}


async function putConfigRules(req, res) {
  try {
    const rules = normalizeRules(req.body);
    if (!rules.break_windows.length) {
      return res.status(400).json({ error: "At least one break window with start/end/days is required" });
    }
    const requestedBy = req.header("x-user-name") || req.header("x-user-id") || "web";
    const result = await pool.query(
      `UPDATE public.plant_config
       SET sap_rules = $1::jsonb, updated_by = $2, updated_at = now()
       WHERE id = 1
       RETURNING sap_rules`,
      [JSON.stringify(rules), requestedBy]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "plant_config row not found — seed via scripts/seed_plant_config.js" });
    }
    
    await reloadPlantConfig(pool).catch(() => {});
    res.json({ data: normalizeRules(result.rows[0].sap_rules), meta: { generated_at: new Date().toISOString() } });
  } catch (err) {
    console.error("putConfigRules error:", err);
    res.status(500).json({ error: err.message });
  }
}


async function getActivityCatalog(req, res) {
  try {
    const data = await loadActivityCatalog();
    res.json({ data, meta: { generated_at: new Date().toISOString() } });
  } catch (err) {
    console.error("getActivityCatalog error:", err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getConfigRules,
  putConfigRules,
  getActivityCatalog,
  normalizeRules,
  normalizeMaxRecordMinutes,
  legacyCategoryMinutes,
  expandLegacyIntoTypeMaps,
  loadActivityCatalog,
  categoryOfActivityType,
  DEFAULT_RULES,
  ALL_DAYS,
  NOT_STAGED_STATUSIDS,
};
