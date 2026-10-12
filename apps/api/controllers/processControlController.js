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
          `SELECT * FROM processcontroldata WHERE emp_sn = $1 ORDER BY id_processcontroldata DESC${limitSql(params, limit)}`,
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
        `SELECT * FROM processcontroldata WHERE emp_sn = $1 ORDER BY id_processcontroldata DESC${limitSql(params, limit)}`,
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
        emp_sn,
        full_name,
        production_order,
        crn_id,
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
          (emp_sn, full_name, production_order, crn_id, operation_text, operation_no, machineid,
           workcenter, validation_status, validation_date, validation_by, tsnumber)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          emp_sn,
          full_name,
          production_order,
          crn_id,
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

const { computeImr } = require('../services/spcService');

const intParam = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const optionalNumber = (value) => {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Same filter the database applies before casting a reading to a number.
const NUMERIC_VALUE_SQL = `pci.value ~ '^\s*-?[0-9]+([.,][0-9]+)?\s*$'`;

exports.spc = {
  // Numeric parameters with the number of readings in the window, for the picker.
  parameters: async (req, res) => {
    try {
      const days = intParam(req.query.days, 30, 1, 365);
      const result = await db.query(
        `SELECT pp.id_parameter, pp.parameter_name, pp.uom, pc.process_name,
                COUNT(r.id_processcontroldata_item)::int AS readings,
                MAX(r.createddate) AS last_reading
           FROM process_parameter pp
           JOIN process_category pc ON pc.id_process = pp.id_process
           LEFT JOIN (
             SELECT pci.id_parameter, pci.id_processcontroldata_item, pcd.createddate
               FROM processcontroldata_item pci
               JOIN processcontroldata pcd ON pcd.id_processcontroldata = pci.id_processcontroldata
              WHERE pcd.createddate >= now() - make_interval(days => $1)
                AND ${NUMERIC_VALUE_SQL}
           ) r ON r.id_parameter = pp.id_parameter
          WHERE pp.isnumber = true
          GROUP BY pp.id_parameter, pp.parameter_name, pp.uom, pc.process_name, pp.parameter_no
          ORDER BY pc.process_name, pp.parameter_no NULLS LAST, pp.parameter_name`,
        [days]
      );
      res.json({ days, parameters: result.rows });
    } catch (err) {
      handleError(res, err);
    }
  },

  // I-MR control chart for one parameter, optionally narrowed to a machine or work center.
  chart: async (req, res) => {
    try {
      const parameterId = Number.parseInt(req.query.parameter, 10);
      if (!Number.isFinite(parameterId)) {
        return res.status(400).json({ error: 'parameter (id_parameter) is required' });
      }
      const days = intParam(req.query.days, 30, 1, 365);
      const limit = intParam(req.query.limit, 500, 10, 2000);
      const machine = String(req.query.machine || '').trim();
      const workcenter = String(req.query.workcenter || '').trim();
      const spec = { lsl: optionalNumber(req.query.lsl), usl: optionalNumber(req.query.usl) };
      if (spec.lsl != null && spec.usl != null && spec.lsl >= spec.usl) {
        return res.status(400).json({ error: 'lsl must be lower than usl' });
      }

      const params = [parameterId, days];
      const filters = [];
      if (machine) {
        params.push(machine);
        filters.push(`AND pcd.machineid = $${params.length}`);
      }
      if (workcenter) {
        params.push(workcenter);
        filters.push(`AND pcd.workcenter = $${params.length}`);
      }
      params.push(limit);

      const [readings, parameter, machines] = await Promise.all([
        db.query(
          `SELECT * FROM (
             SELECT pcd.id_processcontroldata, pcd.createddate, pcd.machineid, pcd.workcenter,
                    pcd.production_order, pcd.operation_no, pcd.full_name, pcd.validation_status,
                    replace(trim(pci.value), ',', '.') AS value
               FROM processcontroldata_item pci
               JOIN processcontroldata pcd ON pcd.id_processcontroldata = pci.id_processcontroldata
              WHERE pci.id_parameter = $1
                AND pcd.createddate >= now() - make_interval(days => $2)
                AND ${NUMERIC_VALUE_SQL}
                ${filters.join(' ')}
              ORDER BY pcd.createddate DESC
              LIMIT $${params.length}
           ) latest
           ORDER BY createddate ASC`,
          params
        ),
        db.query(
          `SELECT pp.id_parameter, pp.parameter_name, pp.uom, pc.process_name
             FROM process_parameter pp
             JOIN process_category pc ON pc.id_process = pp.id_process
            WHERE pp.id_parameter = $1`,
          [parameterId]
        ),
        db.query(
          `SELECT DISTINCT pcd.machineid
             FROM processcontroldata_item pci
             JOIN processcontroldata pcd ON pcd.id_processcontroldata = pci.id_processcontroldata
            WHERE pci.id_parameter = $1
              AND pcd.createddate >= now() - make_interval(days => $2)
              AND pcd.machineid IS NOT NULL
            ORDER BY 1`,
          [parameterId, days]
        ),
      ]);

      if (!parameter.rows.length) return res.status(404).json({ error: 'parameter not found' });

      res.json({
        parameter: parameter.rows[0],
        filters: { days, limit, machine: machine || null, workcenter: workcenter || null },
        machines: machines.rows.map((r) => r.machineid),
        ...computeImr(readings.rows, spec),
      });
    } catch (err) {
      handleError(res, err);
    }
  },
};
