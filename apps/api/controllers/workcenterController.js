const db = global.pool || require('../db');

exports.getAll = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM workcenter');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
