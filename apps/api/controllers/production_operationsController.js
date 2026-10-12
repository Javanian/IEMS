const db = global.pool || require('../db');

function clampLimit(value, fallback = 500, max = 2000) {
  if (
    String(value || '')
      .trim()
      .toLowerCase() === 'all'
  )
    return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

exports.getAll = async (req, res) => {
  try {
    const { order_number, operation_number } = req.query;
    const limit = clampLimit(req.query.limit);
    let conditions = [];
    let params = [];
    let idx = 1;

    if (order_number) {
      conditions.push(`order_number = $${idx++}`);
      params.push(order_number);
    }
    if (operation_number) {
      conditions.push(`operation_number = $${idx++}`);
      params.push(operation_number);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const limitSql = limit == null ? '' : ` LIMIT $${idx}`;
    if (limit != null) params.push(limit);
    const result = await db.query(
      `SELECT * FROM production_operations ${where} ORDER BY id ASC${limitSql}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('production_operations getAll error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.lookup = async (req, res) => {
  try {
    const { order_number, operation_number } = req.query;
    if (!order_number || !operation_number) {
      return res.status(400).json({ error: 'order_number and operation_number are required' });
    }

    const result = await db.query(
      `SELECT * FROM production_operations
       WHERE order_number = $1 AND operation_number = $2
       LIMIT 1`,
      [order_number, operation_number]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('production_operations lookup error:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(`SELECT * FROM production_operations WHERE id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('production_operations getById error:', err);
    res.status(500).json({ error: err.message });
  }
};
