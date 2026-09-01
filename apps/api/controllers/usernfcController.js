const db = global.pool || require('../db');
const { normalizeNfcId, nfcIdVariants } = require('../utils/nfcId');

exports.getAll = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM usernfc');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getdatausernfc = async (req, res) => {
  try {
    const { nfcid } = req.params;
    const variants = nfcIdVariants(nfcid);
    if (!variants.length) {
      return res.status(400).json({ message: 'NFC ID kosong' });
    }

    const result = await db.query('SELECT * FROM usernfc WHERE nfcid = ANY($1::text[])', [
      variants,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    }

    if (result.rows.length > 1) {
      const owners = result.rows.map((r) => `${r.full_name} (${r.snssb})`).join(', ');
      console.error(
        `[usernfc] KARTU GANDA: '${nfcid}' terdaftar atas ${result.rows.length} orang: ${owners}`
      );
      return res.status(409).json({
        message: `Kartu ini terdaftar atas ${result.rows.length} orang: ${owners}. Hubungi admin — jam kerja bisa masuk ke orang yang salah.`,
        duplicates: result.rows.map((r) => ({
          idrow: r.idrow,
          nfcid: r.nfcid,
          snssb: r.snssb,
          full_name: r.full_name,
        })),
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getBySnssb = async (req, res) => {
  try {
    const { snssb } = req.params;
    const result = await db.query('SELECT * FROM usernfc WHERE snssb = $1', [snssb]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getname = async (req, res) => {
  try {
    const { nama } = req.params;
    const result = await db.query('SELECT * FROM usernfc WHERE "full_name" = $1', [nama]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { nfcid, full_name, snssb, machineid, machinename, workcenter, roles } = req.body;

    const canonical = normalizeNfcId(nfcid);

    if (canonical) {
      const clash = await db.query(
        'SELECT full_name, snssb FROM usernfc WHERE nfcid = ANY($1::text[])',
        [nfcIdVariants(canonical)]
      );
      if (clash.rows.length > 0) {
        const owner = clash.rows[0];
        return res.status(409).json({
          error: `Kartu ini sudah terdaftar atas ${owner.full_name} (${owner.snssb}).`,
        });
      }
    }

    const result = await db.query(
      `INSERT INTO usernfc
        (nfcid, full_name, snssb, machineid, machinename, workcenter, roles)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [canonical, full_name, snssb, machineid, machinename, workcenter, roles]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('CREATE USER ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { snssb } = req.params;
    const { nfcid, full_name } = req.body;
    const canonical = normalizeNfcId(nfcid);

    if (canonical) {
      const clash = await db.query(
        'SELECT full_name, snssb FROM usernfc WHERE nfcid = ANY($1::text[]) AND snssb <> $2',
        [nfcIdVariants(canonical), snssb]
      );
      if (clash.rows.length > 0) {
        const owner = clash.rows[0];
        return res.status(409).json({
          error: `Kartu ini sudah terdaftar atas ${owner.full_name} (${owner.snssb}).`,
        });
      }
    }

    const result = await db.query(
      'UPDATE usernfc SET nfcid = $1, full_name = $2 WHERE snssb = $3 RETURNING *',
      [canonical, full_name, snssb]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateMode = async (req, res) => {
  const { snssb } = req.params;
  const { mode } = req.body;
  if (!['single', 'multiple'].includes(mode)) {
    return res.status(400).json({ message: 'Invalid mode value' });
  }
  try {
    const result = await db.query('UPDATE usernfc SET mode = $1 WHERE snssb = $2 RETURNING *', [
      mode,
      snssb,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateInactiveFrom = async (req, res) => {
  const { snssb } = req.params;
  const raw = req.body?.inactive_from;
  const value = raw === null || raw === undefined || raw === '' ? null : String(raw);
  if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return res.status(400).json({ error: 'inactive_from harus format YYYY-MM-DD atau null' });
  }
  try {
    const result = await db.query(
      'UPDATE usernfc SET inactive_from = $1::date WHERE snssb = $2 RETURNING snssb, full_name, inactive_from',
      [value, snssb]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '42703') {
      return res.status(503).json({
        error:
          'Kolom inactive_from belum ada. Jalankan migration 20260722_usernfc_inactive_from.sql.',
      });
    }
    console.error('[USERNFC INACTIVE ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.updatemesin = async (req, res) => {
  try {
    const { serialnumber, machineid, machinename, workcenter } = req.body;

    const result = await db.query(
      `UPDATE usernfc
         SET 
         machineid = $1,
         machinename = $2,
         workcenter = $3
       WHERE snssb = $4
       RETURNING *`,
      [machineid, machinename, workcenter, serialnumber]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error update data');
  }
};

exports.remove = async (req, res) => {
  try {
    const { nfcid } = req.params;

    const result = await db.query('DELETE FROM usernfc WHERE nfcid = ANY($1::text[]) RETURNING *', [
      nfcIdVariants(nfcid),
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Data tidak ditemukan' });
    }

    res.json({ message: 'Deleted successfully', data: result.rows[0] });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'User tidak dapat dihapus karena SNSSB-nya masih tercatat dalam riwayat timesheet.',
      });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.updatenfc = async (req, res) => {
  try {
    const { nfcid: originalNfcId } = req.params;
    const {
      nfcid: newNfcId,
      full_name,
      snssb,
      machineid,
      machinename,
      workcenter,
      roles,
    } = req.body;

    console.log('[USERNFC UPDATE]', originalNfcId, '→', newNfcId, JSON.stringify(req.body));

    const originalVariants = nfcIdVariants(originalNfcId);

    const canonical = normalizeNfcId(newNfcId || originalNfcId);

    if (canonical && !originalVariants.includes(canonical)) {
      const exists = await db.query(
        'SELECT full_name, snssb FROM usernfc WHERE nfcid = ANY($1::text[])',
        [nfcIdVariants(canonical)]
      );
      if (exists.rows.length > 0) {
        const owner = exists.rows[0];
        return res.status(409).json({
          error: `Kartu ini sudah digunakan oleh ${owner.full_name} (${owner.snssb}).`,
        });
      }
    }

    const result = await db.query(
      `UPDATE usernfc
       SET nfcid = $1, full_name = $2, snssb = $3, machineid = $4, machinename = $5, workcenter = $6, roles = $7
       WHERE nfcid = ANY($8::text[])
       RETURNING *`,
      [canonical, full_name, snssb, machineid, machinename, workcenter, roles, originalVariants]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User tidak ditemukan' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[USERNFC ERROR]', err.message);

    if (err.code === '23503') {
      return res.status(409).json({
        error:
          'SNSSB tidak dapat diubah karena sudah memiliki riwayat timesheet yang menggunakan SNSSB ini.',
      });
    }
    res.status(500).json({ error: err.message });
  }
};
