const db = global.pool || require('../db');

const clampLimit = (value, fallback = 200, max = 1000) => {
  if (
    String(value || '')
      .trim()
      .toLowerCase() === 'all'
  )
    return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
};

const limitSql = (params, limit) => {
  if (limit == null) return '';
  params.push(limit);
  return ` LIMIT $${params.length}`;
};

function handleError(res, err) {
  res.status(500).json({ error: err.message });
}

exports.categories = {
  getAll: async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM process_category ORDER BY id_process');
      res.json(result.rows);
    } catch (err) {
      handleError(res, err);
    }
  },

  create: async (req, res) => {
    try {
      const { process_name, description } = req.body;
      const result = await db.query(
        'INSERT INTO process_category (process_name, description) VALUES ($1, $2) RETURNING *',
        [process_name, description]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { process_name, description } = req.body;
      const result = await db.query(
        'UPDATE process_category SET process_name=$1, description=$2 WHERE id_process=$3 RETURNING *',
        [process_name, description, id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  remove: async (req, res) => {
    try {
      await db.query('DELETE FROM process_category WHERE id_process=$1', [req.params.id]);
      res.json({ message: 'Deleted' });
    } catch (err) {
      handleError(res, err);
    }
  },
};

exports.parameters = {
  getAll: async (req, res) => {
    try {
      const { process } = req.query;
      const result = process
        ? await db.query(
            'SELECT * FROM process_parameter WHERE id_process = $1 ORDER BY parameter_no ASC',
            [process]
          )
        : await db.query('SELECT * FROM process_parameter ORDER BY parameter_no ASC');

      res.json(result.rows);
    } catch (err) {
      handleError(res, err);
    }
  },

  create: async (req, res) => {
    try {
      const { parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process } =
        req.body;
      const result = await db.query(
        `INSERT INTO process_parameter
          (parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process } =
        req.body;
      const result = await db.query(
        `UPDATE process_parameter
         SET parameter_name=$1, description=$2, parameter_no=$3, uom=$4,
             ischoice=$5, isnumber=$6, id_process=$7
         WHERE id_parameter=$8 RETURNING *`,
        [parameter_name, description, parameter_no, uom, ischoice, isnumber, id_process, id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  remove: async (req, res) => {
    try {
      await db.query('DELETE FROM process_parameter WHERE id_parameter=$1', [req.params.id]);
      res.json({ message: 'Deleted' });
    } catch (err) {
      handleError(res, err);
    }
  },
};

exports.choices = {
  getAll: async (req, res) => {
    try {
      const { parameter } = req.query;
      const result = parameter
        ? await db.query(
            'SELECT * FROM process_parameter_choicebase WHERE id_parameter = $1 ORDER BY id_choice',
            [parameter]
          )
        : await db.query('SELECT * FROM process_parameter_choicebase ORDER BY id_choice');

      res.json(result.rows);
    } catch (err) {
      handleError(res, err);
    }
  },

  create: async (req, res) => {
    try {
      const { choice_name, description, id_parameter } = req.body;
      const result = await db.query(
        'INSERT INTO process_parameter_choicebase (choice_name, description, id_parameter) VALUES ($1,$2,$3) RETURNING *',
        [choice_name, description, id_parameter]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { choice_name, description, id_parameter } = req.body;
      const result = await db.query(
        'UPDATE process_parameter_choicebase SET choice_name=$1, description=$2, id_parameter=$3 WHERE id_choice=$4 RETURNING *',
        [choice_name, description, id_parameter, id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  remove: async (req, res) => {
    try {
      await db.query('DELETE FROM process_parameter_choicebase WHERE id_choice=$1', [
        req.params.id,
      ]);
      res.json({ message: 'Deleted' });
    } catch (err) {
      handleError(res, err);
    }
  },
};

exports.controls = {
  getAll: async (req, res) => {
    try {
      const { sn, workcenter } = req.query;
      const limit = clampLimit(req.query.limit);
      const params = [];
      let result;

      if (sn) {
        params.push(sn);
        result = await db.query(
          `SELECT * FROM processcontroldata WHERE snssb = $1 ORDER BY id_processcontroldata DESC${limitSql(params, limit)}`,
          params
        );
      } else if (workcenter) {
        params.push(workcenter);
        result = await db.query(
          `SELECT * FROM processcontroldata WHERE workcenter = $1 ORDER BY id_processcontroldata DESC${limitSql(params, limit)}`,
          params
        );
      } else {
        result = await db.query(
          `SELECT * FROM processcontroldata ORDER BY id_processcontroldata DESC${limitSql(params, limit)}`,
          params
        );
      }

      res.json(result.rows);
    } catch (err) {
      handleError(res, err);
    }
  },

  getBySN: async (req, res) => {
    try {
      const { sn } = req.params;
      const limit = clampLimit(req.query.limit);
      const params = [sn];
      const result = await db.query(
        `SELECT * FROM processcontroldata WHERE snssb = $1 ORDER BY id_processcontroldata DESC${limitSql(params, limit)}`,
        params
      );
      res.json(result.rows);
    } catch (err) {
      handleError(res, err);
    }
  },

  getByWCT: async (req, res) => {
    try {
      const { workcenter } = req.params;
      const limit = clampLimit(req.query.limit);
      const params = [workcenter];
      const result = await db.query(
        `SELECT * FROM processcontroldata WHERE workcenter = $1 ORDER BY id_processcontroldata DESC${limitSql(params, limit)}`,
        params
      );
      res.json(result.rows);
    } catch (err) {
      handleError(res, err);
    }
  },

  create: async (req, res) => {
    try {
      const {
        snssb,
        full_name,
        production_order,
        ssbr_id,
        operation_text,
        operation_no,
        machineid,
        workcenter,
        validation_status,
        validation_date,
        validation_by,
        tsnumber,
      } = req.body;
      const result = await db.query(
        `INSERT INTO processcontroldata
          (snssb, full_name, production_order, ssbr_id, operation_text, operation_no, machineid,
           workcenter, validation_status, validation_date, validation_by, tsnumber)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          snssb,
          full_name,
          production_order,
          ssbr_id,
          operation_text,
          operation_no,
          machineid,
          workcenter,
          validation_status,
          validation_date,
          validation_by,
          tsnumber,
        ]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  validate: async (req, res) => {
    try {
      const { id } = req.params;
      const { validation_by, validation_status } = req.body;
      const result = await db.query(
        `UPDATE processcontroldata
         SET validation_status = $1,
             validation_by = $2,
             validation_date = NOW()
         WHERE id_processcontroldata = $3
         RETURNING *`,
        [validation_status, validation_by, id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { validation_by, validation_status } = req.body;
      const result = await db.query(
        `UPDATE processcontroldata
         SET validation_status = $1,
             validation_by = $2,
             validation_date = NOW()
         WHERE id_processcontroldata = $3
         RETURNING *`,
        [validation_status, validation_by, id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  remove: async (req, res) => {
    try {
      await db.query('DELETE FROM processcontroldata WHERE id_processcontroldata=$1', [
        req.params.id,
      ]);
      res.json({ message: 'Deleted' });
    } catch (err) {
      handleError(res, err);
    }
  },
};

exports.items = {
  getAll: async (req, res) => {
    try {
      const limit = clampLimit(req.query.limit, 500, 2000);
      const params = [];
      const result = await db.query(
        `SELECT * FROM processcontroldata_item ORDER BY id_processcontroldata_item DESC${limitSql(params, limit)}`,
        params
      );
      res.json(result.rows);
    } catch (err) {
      handleError(res, err);
    }
  },

  getByControlId: async (req, res) => {
    try {
      const { id } = req.params;
      const result = await db.query(
        'SELECT * FROM processcontroldata_item WHERE id_processcontroldata = $1 ORDER BY id_processcontroldata_item ASC',
        [id]
      );
      res.json(result.rows);
    } catch (err) {
      handleError(res, err);
    }
  },

  create: async (req, res) => {
    try {
      const {
        category_name,
        parameter_name,
        value,
        uom,
        ischoice,
        isnumber,
        status,
        note,
        id_parameter,
        id_processcontroldata,
      } = req.body;
      const result = await db.query(
        `INSERT INTO processcontroldata_item
          (category_name, parameter_name, value, uom, ischoice, isnumber, status, note, id_parameter, id_processcontroldata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          category_name,
          parameter_name,
          value,
          uom,
          ischoice,
          isnumber,
          status,
          note,
          id_parameter,
          id_processcontroldata,
        ]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { value, status, note } = req.body;
      const result = await db.query(
        `UPDATE processcontroldata_item
         SET value=$1, status=$2, note=$3
         WHERE id_processcontroldata_item=$4 RETURNING *`,
        [value, status, note, id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleError(res, err);
    }
  },

  remove: async (req, res) => {
    try {
      await db.query('DELETE FROM processcontroldata_item WHERE id_processcontroldata_item=$1', [
        req.params.id,
      ]);
      res.json({ message: 'Deleted' });
    } catch (err) {
      handleError(res, err);
    }
  },
};
