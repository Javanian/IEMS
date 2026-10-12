const { MANIFEST, ALLOWLIST } = require('./manifest');
const { isAllowed } = require('./effective');

const ENFORCE = String(process.env.RBAC_ENFORCE || '') === '1';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(entry) {
  const parts = String(entry.p).split('/').filter(Boolean);
  const staticCount = parts.filter((s) => !s.startsWith(':')).length;
  const body = parts.map((s) => (s.startsWith(':') ? '[^/]+' : escapeRegex(s))).join('/');
  return { ...entry, re: new RegExp(`^/${body}/?$`), staticCount, segs: parts.length };
}

function bySpecificity(a, b) {
  return b.staticCount - a.staticCount || b.segs - a.segs || b.p.length - a.p.length;
}

const MANIFEST_C = MANIFEST.map(compile).sort(bySpecificity);
const ALLOW_C = ALLOWLIST.map(compile).sort(bySpecificity);

function allowHit(method, path) {
  return ALLOW_C.some((e) => e.m === method && e.re.test(path));
}
function manifestHit(method, path) {
  return MANIFEST_C.find((e) => e.m === method && e.re.test(path)) || null;
}

function warn(msg) {
  console.warn(`[RBAC]${ENFORCE ? '' : ' would-deny'} ${msg}`);
}
function decide(res, next, info) {
  if (ENFORCE) return res.status(403).json({ error: 'Forbidden', ...info });
  return next();
}

module.exports = async function rbacGuard(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const path = req.path;
  if (allowHit(method, path)) return next();

  const hit = manifestHit(method, path);
  if (!hit) {
    warn(`UNMAPPED ${method} ${path}`);
    return decide(res, next, { reason: 'unmapped_write' });
  }

  try {
    const userId = req.headers['x-user-id'];
    const role = req.headers['x-user-role'];
    if (await isAllowed(userId, role, hit.f, hit.a)) return next();
    warn(
      `${method} ${path} feature=${hit.f} action=${hit.a} role=${role || '-'} user=${userId || '-'}`
    );
    return decide(res, next, { reason: 'insufficient_permission', feature: hit.f });
  } catch (err) {
    console.error('[RBAC] check error:', err.message);

    return ENFORCE ? res.status(500).json({ error: 'RBAC check failed' }) : next();
  }
};

module.exports.ENFORCE = ENFORCE;
module.exports._test = { manifestHit, allowHit };
