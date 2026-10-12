const db = require('../db');
const { resolveLevel, actionAllowed } = require('./permissionMatrix');

async function getUserOverrides(userId) {
  const id = parseInt(userId, 10);
  if (!Number.isInteger(id)) return {};
  const r = await db.query(
    'SELECT feature_id, level FROM rbac.user_permissions WHERE user_id = $1',
    [id]
  );
  const map = {};
  for (const row of r.rows) map[row.feature_id] = row.level;
  return map;
}

async function effectiveLevel(userId, role, feature) {
  const overrides = await getUserOverrides(userId);
  return overrides[feature] ?? resolveLevel(role, feature);
}

async function isAllowed(userId, role, feature, action) {
  return actionAllowed(await effectiveLevel(userId, role, feature), action);
}

async function effectiveMap(userId, role, featureIds) {
  const overrides = await getUserOverrides(userId);
  const out = {};
  for (const f of featureIds) {
    const roleLevel = resolveLevel(role, f);
    const override = overrides[f] ?? null;
    out[f] = { role: roleLevel, override, effective: override ?? roleLevel };
  }
  return out;
}

module.exports = { getUserOverrides, effectiveLevel, isAllowed, effectiveMap };
