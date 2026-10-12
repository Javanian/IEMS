const crypto = require('crypto');
const argon2 = require('@node-rs/argon2');
const db = global.pool || require('../db');
const { effectiveMap } = require('../rbac/effective');
const { FEATURE_IDS, FEATURE_ID_SET } = require('../rbac/features');
const { LEVELS } = require('../rbac/permissionMatrix');

function sha256Password(password) {
  return `sha256$${crypto
    .createHash('sha256')
    .update(String(password || ''))
    .digest('hex')}`;
}

async function hashPassword(password) {
  return argon2.hash(String(password || ''), { algorithm: argon2.Algorithm.Argon2id });
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const stored = String(storedHash);
  const pw = String(password || '');

  if (stored.startsWith('$argon2')) {
    try {
      return await argon2.verify(stored, pw);
    } catch {
      return false;
    }
  }

  if (stored.startsWith('sha256$')) {
    return timingSafeEqualStr(stored, sha256Password(pw));
  }

  return timingSafeEqualStr(stored, pw);
}

function isAdministratorRequest(req) {
  const role = String(req.headers['x-user-role'] || req.body?.requesterRole || '')
    .trim()
    .toLowerCase();
  return role === 'administrator';
}

function rejectNonAdministrator(req, res) {
  if (isAdministratorRequest(req)) return false;
  res.status(403).json({
    success: false,
    error: 'Hanya administrator yang boleh manage users',
  });
  return true;
}

exports.login = async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username dan password wajib diisi',
      });
    }

    const result = await db.query(
      `
        SELECT
          id,
          username,
          password_hash,
          name,
          COALESCE(NULLIF(roles, ''), role) AS roles
        FROM public.users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `,
      [username]
    );

    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({
        success: false,
        error: 'Username atau password tidak sesuai',
      });
    }

    if (!String(user.password_hash || '').startsWith('$argon2')) {
      try {
        const upgraded = await hashPassword(password);
        await db.query(
          'UPDATE public.users SET password_hash = $1, updated_at = now() WHERE id = $2',
          [upgraded, user.id]
        );
      } catch (upErr) {
        console.error('password lazy-upgrade failed for user id', user.id, '-', upErr.message);
      }
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roles: user.roles,
      },
    });
  } catch (err) {
    console.error('auth login error:', err);
    return res.status(500).json({
      success: false,
      error: 'Gagal login',
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const oldPassword = String(req.body?.oldPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const retypeNewPassword = String(req.body?.retypeNewPassword || '');

    if (!username || !oldPassword || !newPassword || !retypeNewPassword) {
      return res.status(400).json({
        success: false,
        error: 'Old password, new password, dan retype new password wajib diisi',
      });
    }

    if (newPassword !== retypeNewPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password dan retype new password tidak sama',
      });
    }

    if (newPassword.length < 5) {
      return res.status(400).json({
        success: false,
        error: 'New password minimal 5 karakter',
      });
    }

    const current = await db.query(
      `
        SELECT id, username, password_hash, name, COALESCE(NULLIF(roles, ''), role) AS roles
        FROM public.users
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1
      `,
      [username]
    );

    const user = current.rows[0];
    if (!user || !(await verifyPassword(oldPassword, user.password_hash))) {
      return res.status(401).json({
        success: false,
        error: 'Old password tidak sesuai',
      });
    }

    await db.query(
      `
        UPDATE public.users
        SET password_hash = $1, updated_at = now()
        WHERE id = $2
      `,
      [await hashPassword(newPassword), user.id]
    );

    return res.json({
      success: true,
      message: 'Password berhasil diubah',
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roles: user.roles,
      },
    });
  } catch (err) {
    console.error('auth changePassword error:', err);
    return res.status(500).json({
      success: false,
      error: 'Gagal ubah password',
    });
  }
};

exports.listUsers = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;

  try {
    const result = await db.query(
      `
        SELECT
          id,
          username,
          name,
          COALESCE(NULLIF(roles, ''), role) AS roles,
          created_at,
          updated_at
        FROM public.users
        ORDER BY username ASC
      `
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('auth listUsers error:', err);
    return res.status(500).json({
      success: false,
      error: 'Gagal memuat users',
    });
  }
};

exports.createUser = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;

  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const roles = String(req.body?.roles || '')
      .trim()
      .toLowerCase();
    const name = String(req.body?.name || username).trim() || username;

    if (!username || !password || !roles) {
      return res.status(400).json({
        success: false,
        error: 'Username, password, dan roles wajib diisi',
      });
    }

    if (password.length < 5) {
      return res.status(400).json({
        success: false,
        error: 'Password minimal 5 karakter',
      });
    }

    const result = await db.query(
      `
        INSERT INTO public.users (username, password_hash, name, role, roles, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $4, now(), now())
        RETURNING id, username, name, roles, created_at, updated_at
      `,
      [username, await hashPassword(password), name, roles]
    );

    return res.status(201).json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error('auth createUser error:', err);
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'Username sudah terdaftar',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Gagal membuat user',
    });
  }
};

exports.updateUser = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;

  try {
    const id = Number(req.params.id);
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const roles = String(req.body?.roles || '')
      .trim()
      .toLowerCase();
    const name = String(req.body?.name || username).trim() || username;

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: 'ID user tidak valid',
      });
    }

    if (!username || !roles) {
      return res.status(400).json({
        success: false,
        error: 'Username dan roles wajib diisi',
      });
    }

    if (password && password.length < 5) {
      return res.status(400).json({
        success: false,
        error: 'Password minimal 5 karakter',
      });
    }

    const params = password
      ? [username, name, roles, await hashPassword(password), id]
      : [username, name, roles, id];
    const sql = password
      ? `
          UPDATE public.users
          SET username = $1, name = $2, role = $3, roles = $3, password_hash = $4, updated_at = now()
          WHERE id = $5
          RETURNING id, username, name, roles, created_at, updated_at
        `
      : `
          UPDATE public.users
          SET username = $1, name = $2, role = $3, roles = $3, updated_at = now()
          WHERE id = $4
          RETURNING id, username, name, roles, created_at, updated_at
        `;

    const result = await db.query(sql, params);
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'User tidak ditemukan',
      });
    }

    return res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error('auth updateUser error:', err);
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'Username sudah terdaftar',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Gagal update user',
    });
  }
};

exports.deleteUser = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;

  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        error: 'ID user tidak valid',
      });
    }

    const result = await db.query('DELETE FROM public.users WHERE id = $1 RETURNING id', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'User tidak ditemukan',
      });
    }

    return res.json({
      success: true,
      message: 'User berhasil dihapus',
    });
  } catch (err) {
    console.error('auth deleteUser error:', err);
    return res.status(500).json({
      success: false,
      error: 'Gagal hapus user',
    });
  }
};

const VALID_LEVELS = new Set([LEVELS.NO_ACCESS, LEVELS.READ_ONLY, LEVELS.FULL_ACCESS]);

async function fetchUserRole(userId) {
  const r = await db.query(
    `SELECT id, username, name, COALESCE(NULLIF(roles,''), role) AS role
     FROM public.users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

exports.getUserPermissions = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;
  const userId = parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ success: false, error: 'id user tidak valid' });
  }
  try {
    const user = await fetchUserRole(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    const map = await effectiveMap(userId, user.role, FEATURE_IDS);
    return res.json({
      success: true,
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
      permissions: map,
    });
  } catch (err) {
    console.error('auth getUserPermissions error:', err);
    return res.status(500).json({ success: false, error: 'Gagal ambil permission' });
  }
};

exports.updateUserPermissions = async (req, res) => {
  if (rejectNonAdministrator(req, res)) return;
  const userId = parseInt(req.params.id, 10);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ success: false, error: 'id user tidak valid' });
  }
  const overrides = req.body?.overrides;
  if (!overrides || typeof overrides !== 'object') {
    return res
      .status(400)
      .json({ success: false, error: 'overrides wajib berupa objek { feature_id: level|null }' });
  }
  const setBy = parseInt(req.headers['x-user-id'], 10) || null;

  const pool = db.pool || db;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(`SELECT id FROM public.users WHERE id = $1 LIMIT 1`, [userId]);
    if (user.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }
    for (const [featureId, rawLevel] of Object.entries(overrides)) {
      if (!FEATURE_ID_SET.has(featureId)) continue;
      const level = rawLevel == null ? null : String(rawLevel);
      if (level === null || level === 'inherit') {
        await client.query(
          `DELETE FROM rbac.user_permissions WHERE user_id = $1 AND feature_id = $2`,
          [userId, featureId]
        );
      } else {
        if (!VALID_LEVELS.has(level)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, error: `level tidak valid: ${level}` });
        }
        await client.query(
          `INSERT INTO rbac.user_permissions (user_id, feature_id, level, updated_by, updated_at)
           VALUES ($1,$2,$3,$4, now())
           ON CONFLICT (user_id, feature_id)
           DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [userId, featureId, level, setBy]
        );
      }
    }
    await client.query('COMMIT');
    const fresh = await fetchUserRole(userId);
    const map = await effectiveMap(userId, fresh.role, FEATURE_IDS);
    return res.json({ success: true, permissions: map });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('auth updateUserPermissions error:', err);
    return res.status(500).json({ success: false, error: 'Gagal simpan permission' });
  } finally {
    client.release();
  }
};

exports.getMyPermissions = async (req, res) => {
  const userId = parseInt(req.headers['x-user-id'], 10);
  const role = String(req.headers['x-user-role'] || '').trim();
  try {
    const map = await effectiveMap(Number.isInteger(userId) ? userId : null, role, FEATURE_IDS);
    const flat = {};
    for (const [f, v] of Object.entries(map)) flat[f] = v.effective;
    return res.json({ success: true, role, permissions: flat });
  } catch (err) {
    console.error('auth getMyPermissions error:', err);
    return res.status(500).json({ success: false, error: 'Gagal ambil permission' });
  }
};
