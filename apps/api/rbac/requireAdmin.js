module.exports = function requireAdmin(req, res, next) {
  const role = String(req.headers['x-user-role'] || '')
    .trim()
    .toLowerCase();
  if (role === 'administrator' || role === 'admin') return next();
  return res.status(403).json({ error: 'Forbidden: administrator only' });
};
