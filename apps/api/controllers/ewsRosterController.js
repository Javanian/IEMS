const db = global.pool || require('../db');
const { generateRoster } = require('../services/rosterGenerator');
const { resolveTimezone } = require('../config/timezone');

const VALID_STATUS = new Set(['SCHEDULED', 'OFF', 'LEAVE', 'SICK', 'PERMIT']);
const TZ = resolveTimezone();

function assertIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')))
    throw new Error('Invalid date. Use YYYY-MM-DD.');
}

function clampText(value, fallback = '', max = 160) {
  const t = String(value ?? fallback).trim();
  return t.length > max ? t.slice(0, max) : t;
}

async function getRoster(req, res) {
  try {
    const date = req.query.date;
    assertIsoDate(date);
    const result = await db.query(
      `
      WITH logged AS (
        SELECT NULLIF(BTRIM(t.serialnumber), '') AS op, SUM(t.duration::float) AS recorded
        FROM public.timesheet_transaction t
        WHERE t.longdate_checkin >= ($1::date)::timestamp
          AND t.longdate_checkin <  ($1::date + 2)::timestamp
          AND COALESCE(t.state_flag, 0) <> 5 AND COALESCE(t.duration, 0) > 0
          AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
          AND (CASE WHEN (t.longdate_checkin AT TIME ZONE $2)::time < TIME '07:00'
                    THEN (t.longdate_checkin AT TIME ZONE $2)::date - 1
                    ELSE (t.longdate_checkin AT TIME ZONE $2)::date END) = $1::date
        GROUP BY 1
      )
      SELECT r.serialnumber, u.full_name AS operator_name, r.eff_shift AS scheduled_shift, r.eff_std AS scheduled_standard_hours,
             r.status, r.source, r.updated_by, r.half_day,
             COALESCE(lg.recorded, 0)::float AS recorded_hours,
             ((r.business_date + os.end_time
               + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) <= now() AS completed,
             CASE WHEN r.status <> 'SCHEDULED' THEN r.status
                  WHEN ((r.business_date + os.end_time + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) > now() THEN 'IN_PROGRESS'
                  WHEN COALESCE(lg.recorded, 0) > 0 THEN 'PRESENT'
                  ELSE 'ABSENT' END AS attendance
      FROM ews.roster_effective r
      JOIN ews.operator_shift os ON os.shift_code = r.eff_shift
      LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
      LEFT JOIN logged lg ON lg.op = r.serialnumber
      WHERE r.business_date = $1::date
      ORDER BY r.eff_shift, u.full_name NULLS LAST, r.serialnumber
      `,
      [date, TZ]
    );
    res.json({ data: result.rows, meta: { business_date: date, count: result.rows.length } });
  } catch (err) {
    if (err.code === '42P01')
      return res
        .status(503)
        .json({ error: 'Roster tables not created. Run the roster migration.' });
    console.error('ews roster get error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function updateStatus(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, '', 80);
    const business_date = req.body?.business_date;
    const status = String(req.body?.status || '').toUpperCase();
    const updated_by = clampText(req.body?.updated_by, 'ews-roster-ui', 120);
    assertIsoDate(business_date);
    if (!serialnumber) return res.status(400).json({ error: 'serialnumber is required' });
    if (!VALID_STATUS.has(status)) return res.status(400).json({ error: 'Invalid status' });

    const result = await db.query(
      `
      UPDATE ews.shift_roster
      SET status = $3, source = 'manual', updated_by = $4, updated_at = now()
      WHERE serialnumber = $1 AND business_date = $2::date
      RETURNING serialnumber, business_date::text, scheduled_shift, status, source, updated_by
      `,
      [serialnumber, business_date, status, updated_by]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Roster row not found for that operator/date' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('ews roster status error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function updateHalfDay(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, '', 80);
    const business_date = req.body?.business_date;
    const half_day = Boolean(req.body?.half_day);
    const updated_by = clampText(req.body?.updated_by, 'ews-roster-ui', 120);
    assertIsoDate(business_date);
    if (!serialnumber) return res.status(400).json({ error: 'serialnumber is required' });

    const result = await db.query(
      `
      UPDATE ews.shift_roster
      SET half_day = $3, source = 'manual', updated_by = $4, updated_at = now()
      WHERE serialnumber = $1 AND business_date = $2::date
      RETURNING serialnumber, business_date::text, half_day, status, source, updated_by
      `,
      [serialnumber, business_date, half_day, updated_by]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Roster row not found for that operator/date' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('ews roster half-day error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function deleteRoster(req, res) {
  try {
    const business_date = req.body?.business_date;
    const shift = String(req.body?.shift || '').toUpperCase();
    const serialnumber = clampText(req.body?.serialnumber, '', 80);
    assertIsoDate(business_date);
    if (shift && shift !== 'DAY' && shift !== 'NIGHT') {
      return res.status(400).json({ error: 'shift must be DAY or NIGHT' });
    }

    const todayRes = await db.query(`SELECT (now() AT TIME ZONE $1)::date AS today`, [TZ]);
    if (String(business_date) < todayRes.rows[0].today) {
      return res.status(400).json({
        error:
          'Past dates are frozen (adoption already counted). Only today or future dates can be deleted.',
      });
    }

    const params = [business_date];
    let where = `business_date = $1::date`;
    if (shift) {
      params.push(shift);
      where += ` AND scheduled_shift = $${params.length}`;
    }
    if (serialnumber) {
      params.push(serialnumber);
      where += ` AND serialnumber = $${params.length}`;
    }

    const result = await db.query(`DELETE FROM ews.shift_roster WHERE ${where}`, params);
    res.json({
      data: {
        business_date,
        shift: shift || null,
        serialnumber: serialnumber || null,
        rows_deleted: result.rowCount,
      },
    });
  } catch (err) {
    console.error('ews roster delete error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function getRosterMonth(req, res) {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month. Use YYYY-MM.' });
    }
    const scope = String(req.query.scope || 'all') === 'team' ? 'team' : 'all';
    const userId = String(req.headers['x-user-id'] || '');
    const params = [`${month}-01`, TZ];
    let teamFilter = '';
    if (scope === 'team') {
      if (!/^\d+$/.test(userId)) return res.json({ data: [], meta: { month, scope } });
      params.push(userId);
      teamFilter = ` AND r.serialnumber IN (
        SELECT member_serialnumber FROM ews.foreman_team WHERE foreman_user_id = $${params.length}
      )`;
    }
    const result = await db.query(
      `
      WITH logged AS (
        SELECT NULLIF(BTRIM(t.serialnumber), '') AS op, SUM(t.duration::float) AS recorded
        FROM public.timesheet_transaction t
        WHERE t.longdate_checkin >= ($1::date)::timestamp
          AND t.longdate_checkin <  ($1::date + interval '1 month')::timestamp
          AND COALESCE(t.state_flag, 0) <> 5 AND COALESCE(t.duration, 0) > 0
          AND NULLIF(BTRIM(t.serialnumber), '') IS NOT NULL
        GROUP BY 1
      )
      SELECT r.serialnumber, u.full_name AS operator_name, r.business_date::text,
             r.eff_shift AS scheduled_shift, r.eff_std AS scheduled_standard_hours,
             r.status, r.half_day, r.shift_locked,
             COALESCE(lg.recorded, 0)::float AS recorded_hours,
             ((r.business_date + os.end_time
               + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) <= now() AS completed,
             CASE WHEN r.status <> 'SCHEDULED' THEN r.status
                  WHEN ((r.business_date + os.end_time + CASE WHEN os.crosses_midnight THEN INTERVAL '1 day' ELSE INTERVAL '0' END) AT TIME ZONE $2) > now() THEN 'IN_PROGRESS'
                  WHEN COALESCE(lg.recorded, 0) > 0 THEN 'PRESENT'
                  ELSE 'ABSENT' END AS attendance
      FROM ews.roster_effective r
      JOIN ews.operator_shift os ON os.shift_code = r.eff_shift
      LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = r.serialnumber
      LEFT JOIN logged lg ON lg.op = r.serialnumber
      WHERE r.business_date >= $1::date AND r.business_date < ($1::date + interval '1 month')::date
      ${teamFilter}
      ORDER BY u.full_name NULLS LAST, r.serialnumber, r.business_date
      `,
      params
    );
    res.json({ data: result.rows, meta: { month, scope, count: result.rows.length } });
  } catch (err) {
    if (err.code === '42P01')
      return res.status(503).json({ error: 'Roster tables not created. Run the roster migration.' });
    console.error('ews roster month error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function bulkUpdateRoster(req, res) {
  try {
    const serialnumbers = (req.body?.serialnumbers || [])
      .map((s) => String(s).trim())
      .filter(Boolean);
    const businessDates = (req.body?.business_dates || [])
      .map((d) => String(d).trim())
      .filter(Boolean);
    const status = String(req.body?.status || '').toUpperCase();
    const hasHalfDay = req.body?.half_day !== undefined;
    const halfDay = Boolean(req.body?.half_day);
    const updated_by = clampText(req.body?.updated_by, 'ews-roster-ui', 120);

    if (!serialnumbers.length || !businessDates.length) {
      return res.status(400).json({ error: 'serialnumbers dan business_dates wajib diisi' });
    }
    if (status && !VALID_STATUS.has(status)) return res.status(400).json({ error: 'Invalid status' });
    if (!status && !hasHalfDay) return res.status(400).json({ error: 'status atau half_day wajib diisi' });
    for (const d of businessDates) assertIsoDate(d);

    const todayRes = await db.query(`SELECT (now() AT TIME ZONE $1)::date AS today`, [TZ]);
    const today = todayRes.rows[0].today;
    if (businessDates.some((d) => d < today)) {
      return res.status(400).json({
        error:
          'Past dates are frozen (adoption already counted). Only today or future dates can be updated.',
      });
    }

    const sets = [];
    const params = [serialnumbers, businessDates];
    if (status) {
      params.push(status);
      sets.push(`status = $${params.length}`);
    }
    if (hasHalfDay) {
      params.push(halfDay);
      sets.push(`half_day = $${params.length}`);
    }
    params.push(updated_by);
    sets.push(`source = 'manual', updated_by = $${params.length}, updated_at = now()`);

    const result = await db.query(
      `UPDATE ews.shift_roster SET ${sets.join(', ')}
       WHERE serialnumber = ANY($1::text[]) AND business_date = ANY($2::date[])`,
      params
    );
    res.json({
      data: {
        rows_updated: result.rowCount,
        serialnumbers: serialnumbers.length,
        business_dates: businessDates.length,
        status: status || null,
        half_day: hasHalfDay ? halfDay : null,
      },
    });
  } catch (err) {
    console.error('ews roster bulk error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function getForemanTeam(req, res) {
  try {
    const [foremen, members, operators] = await Promise.all([
      db.query(
        `SELECT id, username, name FROM public.users
         WHERE COALESCE(NULLIF(roles, ''), role) = 'foreman'
         ORDER BY lower(name), username`
      ),
      db.query(
        `SELECT ft.foreman_user_id, ft.member_serialnumber, u.full_name
         FROM ews.foreman_team ft
         LEFT JOIN public.usernfc u ON NULLIF(BTRIM(u.snssb), '') = ft.member_serialnumber
         ORDER BY ft.member_serialnumber`
      ),
      db.query(
        `SELECT snssb, full_name FROM public.usernfc
         WHERE snssb IS NOT NULL AND btrim(snssb) <> '' AND full_name IS NOT NULL AND btrim(full_name) <> ''
           AND (inactive_from IS NULL OR inactive_from > (now() AT TIME ZONE $1)::date)
         ORDER BY lower(full_name), snssb`,
        [TZ]
      ),
    ]);
    res.json({
      data: {
        foremen: foremen.rows,
        members: members.rows,
        operators: operators.rows,
      },
    });
  } catch (err) {
    if (err.code === '42P01')
      return res.status(503).json({ error: 'Foreman team table not created. Run the migration.' });
    console.error('ews foreman team error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function setForemanMember(req, res) {
  try {
    const foremanUserId = Number.parseInt(req.body?.foreman_user_id, 10);
    const memberSerialnumber = clampText(req.body?.member_serialnumber, '', 80);
    const created_by = clampText(req.body?.updated_by, 'ews-roster-ui', 120);
    if (!Number.isInteger(foremanUserId) || foremanUserId < 1) {
      return res.status(400).json({ error: 'foreman_user_id wajib diisi' });
    }
    if (!memberSerialnumber) return res.status(400).json({ error: 'member_serialnumber wajib diisi' });

    const f = await db.query(
      `SELECT id FROM public.users WHERE id = $1 AND COALESCE(NULLIF(roles, ''), role) = 'foreman'`,
      [foremanUserId]
    );
    if (!f.rows.length) return res.status(404).json({ error: 'Foreman tidak ditemukan (users role foreman)' });
    const m = await db.query(`SELECT 1 FROM public.usernfc WHERE NULLIF(BTRIM(snssb), '') = $1`, [
      memberSerialnumber,
    ]);
    if (!m.rows.length) return res.status(404).json({ error: 'Operator NFC tidak ditemukan' });

    const client = await (db.pool || db).connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ews.foreman_team WHERE member_serialnumber = $1`, [
        memberSerialnumber,
      ]);
      const ins = await client.query(
        `INSERT INTO ews.foreman_team (foreman_user_id, member_serialnumber, created_by)
         VALUES ($1, $2, $3) RETURNING id, foreman_user_id, member_serialnumber`,
        [foremanUserId, memberSerialnumber, created_by]
      );
      await client.query('COMMIT');
      res.json({ data: ins.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('ews foreman set member error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function removeForemanMember(req, res) {
  try {
    const memberSerialnumber = clampText(req.body?.member_serialnumber, '', 80);
    if (!memberSerialnumber) return res.status(400).json({ error: 'member_serialnumber wajib diisi' });
    const result = await db.query(
      `DELETE FROM ews.foreman_team WHERE member_serialnumber = $1 RETURNING id, foreman_user_id, member_serialnumber`,
      [memberSerialnumber]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Member tidak ada di tim mana pun' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('ews foreman remove member error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function getConfig(req, res) {
  try {
    const [shifts, workdays, rotation, groups, members, roster] = await Promise.all([
      db.query(
        `SELECT shift_code, shift_name, start_time::text, end_time::text, crosses_midnight, standard_hours, is_active FROM ews.operator_shift ORDER BY shift_code`
      ),
      db.query(
        `SELECT day_of_week, runs_day, runs_night FROM ews.roster_workday_rule ORDER BY day_of_week`
      ),
      db.query(
        `SELECT id, anchor_week_start::text, anchor_group_a_shift, rotation_period_weeks, week_start_dow, effective_from::text, is_active FROM ews.rotation_config WHERE is_active ORDER BY effective_from DESC, id DESC LIMIT 1`
      ),
      db.query(
        `SELECT rotation_group, COUNT(*)::int AS n FROM ews.operator_rotation_group GROUP BY rotation_group ORDER BY rotation_group`
      ),
      db.query(`SELECT g.serialnumber, g.rotation_group, u.full_name, u.inactive_from::text AS inactive_from
                FROM ews.operator_rotation_group g
                LEFT JOIN usernfc u ON u.snssb = g.serialnumber
                ORDER BY g.rotation_group, u.full_name NULLS LAST, g.serialnumber`),
      db.query(
        `SELECT snssb, full_name FROM usernfc
                WHERE snssb IS NOT NULL AND btrim(snssb) <> '' AND full_name IS NOT NULL AND btrim(full_name) <> ''
                  AND (inactive_from IS NULL OR inactive_from > (now() AT TIME ZONE $1)::date)
                ORDER BY lower(full_name), snssb`,
        [TZ]
      ),
    ]);
    res.json({
      data: {
        shifts: shifts.rows,
        workday_rules: workdays.rows,
        rotation_config: rotation.rows[0] || null,
        group_counts: groups.rows,
        group_members: members.rows,
        operators: roster.rows,
      },
    });
  } catch (err) {
    if (err.code === '42P01')
      return res
        .status(503)
        .json({ error: 'Roster tables not created. Run the roster migration.' });
    console.error('ews roster config error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function updateWorkday(req, res) {
  try {
    const dow = Number.parseInt(req.body?.day_of_week, 10);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6)
      return res.status(400).json({ error: 'day_of_week must be 0..6' });
    const result = await db.query(
      `UPDATE ews.roster_workday_rule SET runs_day = $2, runs_night = $3, updated_at = now()
       WHERE day_of_week = $1 RETURNING day_of_week, runs_day, runs_night`,
      [dow, Boolean(req.body?.runs_day), Boolean(req.body?.runs_night)]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'day_of_week not found' });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('ews roster workday error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function updateGroup(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, '', 80);
    const group = String(req.body?.rotation_group || '').toUpperCase();
    const updated_by = clampText(req.body?.updated_by, 'ews-roster-ui', 120);
    if (!serialnumber) return res.status(400).json({ error: 'serialnumber is required' });
    if (group !== 'A' && group !== 'B')
      return res.status(400).json({ error: 'rotation_group must be A or B' });
    const result = await db.query(
      `
      INSERT INTO ews.operator_rotation_group (serialnumber, rotation_group, source, effective_from, updated_by)
      VALUES ($1, $2, 'manual', (now() AT TIME ZONE $4)::date, $3)
      ON CONFLICT (serialnumber) DO UPDATE SET
        rotation_group = EXCLUDED.rotation_group, source = 'manual',
        updated_by = EXCLUDED.updated_by, updated_at = now()
      RETURNING serialnumber, rotation_group, source
      `,
      [serialnumber, group, updated_by, TZ]
    );
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error('ews roster group error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function generate(req, res) {
  try {
    const from = req.body?.from;
    const to = req.body?.to;
    assertIsoDate(from);
    assertIsoDate(to);
    const inserted = await generateRoster(from, to);
    res.json({ data: { from, to, rows_inserted: inserted } });
  } catch (err) {
    console.error('ews roster generate error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function setLock(req, res) {
  try {
    const serialnumber = clampText(req.body?.serialnumber, '', 80);
    const locked_shift = String(req.body?.locked_shift || '')
      .trim()
      .toUpperCase();
    const effective_from = req.body?.effective_from;
    const lock_weeks = Number.parseInt(req.body?.lock_weeks, 10);
    const created_by = clampText(req.body?.created_by, 'ews-roster-ui', 120);

    if (!serialnumber) return res.status(400).json({ error: 'serialnumber is required' });
    if (locked_shift !== 'DAY' && locked_shift !== 'NIGHT') {
      return res.status(400).json({ error: 'locked_shift must be DAY or NIGHT' });
    }
    assertIsoDate(effective_from);
    if (!Number.isInteger(lock_weeks) || lock_weeks < 1) {
      return res.status(400).json({ error: 'lock_weeks must be a positive integer' });
    }

    const pre = await db.query(
      `SELECT
         (SELECT week_start_dow FROM ews.rotation_config WHERE is_active ORDER BY effective_from DESC, id DESC LIMIT 1) AS week_start_dow,
         ($1::date >= (now() AT TIME ZONE $3)::date) AS not_historical,
         EXISTS (SELECT 1 FROM ews.operator_rotation_group WHERE serialnumber = $2) AS operator_exists`,
      [effective_from, serialnumber, TZ]
    );
    const p = pre.rows[0] || {};
    if (p.week_start_dow === null || p.week_start_dow === undefined) {
      return res.status(503).json({ error: 'No active rotation_config found' });
    }
    if (!p.operator_exists)
      return res.status(404).json({ error: 'Operator tidak ada di rotation roster' });
    if (!p.not_historical) {
      return res
        .status(400)
        .json({ error: 'effective_from tidak boleh di masa lalu (lock forward-only)' });
    }

    const result = await db.query(
      `
      WITH cfg AS (
        SELECT week_start_dow FROM ews.rotation_config WHERE is_active ORDER BY effective_from DESC, id DESC LIMIT 1
      )
      INSERT INTO ews.operator_shift_lock (serialnumber, locked_shift, effective_from, lock_weeks, lock_end, created_by)
      SELECT $1, $2, $3::date, $4::int,
             ($3::date - ((EXTRACT(dow FROM $3::date)::int - cfg.week_start_dow + 7) % 7)) + $4::int * 7,
             $5
      FROM cfg
      RETURNING id, serialnumber, locked_shift, effective_from::text, lock_weeks, lock_end::text, created_by, created_at
      `,
      [serialnumber, locked_shift, effective_from, lock_weeks, created_by]
    );
    res.json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23P01') {
      return res.status(409).json({
        error: 'Operator sudah punya lock aktif yang tumpang tindih pada rentang tanggal itu',
      });
    }
    if (err.code === '23503')
      return res.status(400).json({ error: 'locked_shift bukan shift yang dikenal' });
    if (err.code === '23514')
      return res.status(400).json({ error: 'Nilai lock tidak valid (cek lock_weeks / lock_end)' });
    if (err.code === '42P01')
      return res
        .status(503)
        .json({ error: 'Tabel lock belum ada. Jalankan migration operator_shift_lock.' });
    console.error('ews roster setLock error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function cancelLock(req, res) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid lock id' });

    const result = await db.query(
      `
      UPDATE ews.operator_shift_lock
      SET cancelled_at = now()
      WHERE id = $1 AND cancelled_at IS NULL AND effective_from >= (now() AT TIME ZONE $2)::date
      RETURNING id, serialnumber, locked_shift, effective_from::text, lock_end::text, cancelled_at
      `,
      [id, TZ]
    );
    if (result.rows.length) return res.json({ data: result.rows[0] });

    const why = await db.query(
      `SELECT (cancelled_at IS NOT NULL) AS already_cancelled,
              (effective_from < (now() AT TIME ZONE $2)::date) AS already_started
       FROM ews.operator_shift_lock WHERE id = $1`,
      [id, TZ]
    );
    if (!why.rows.length) return res.status(404).json({ error: 'Lock tidak ditemukan' });
    const w = why.rows[0];
    if (w.already_cancelled) return res.status(409).json({ error: 'Lock sudah dibatalkan' });
    if (w.already_started) {
      return res.status(400).json({
        error: 'Tidak bisa membatalkan lock yang effective_from-nya sudah lewat (forward-only)',
      });
    }
    return res.status(400).json({ error: 'Gagal membatalkan lock' });
  } catch (err) {
    if (err.code === '42P01')
      return res
        .status(503)
        .json({ error: 'Tabel lock belum ada. Jalankan migration operator_shift_lock.' });
    console.error('ews roster cancelLock error:', err);
    res.status(400).json({ error: err.message });
  }
}

async function listLocks(req, res) {
  try {
    const includeAll = String(req.query.all || '') === '1';
    const result = await db.query(
      `
      SELECT l.id, l.serialnumber, l.locked_shift, l.effective_from::text, l.lock_weeks, l.lock_end::text,
             l.created_by, l.created_at, l.cancelled_at, u.full_name,
             (l.cancelled_at IS NULL AND l.lock_end > (now() AT TIME ZONE $1)::date) AS active_now
      FROM ews.operator_shift_lock l
      LEFT JOIN usernfc u ON u.snssb = l.serialnumber
      WHERE $2::boolean OR l.cancelled_at IS NULL
      ORDER BY l.effective_from DESC, l.serialnumber
      `,
      [TZ, includeAll]
    );
    res.json({ data: result.rows });
  } catch (err) {
    if (err.code === '42P01')
      return res
        .status(503)
        .json({ error: 'Tabel lock belum ada. Jalankan migration operator_shift_lock.' });
    console.error('ews roster listLocks error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  getRoster,
  getRosterMonth,
  updateStatus,
  updateHalfDay,
  deleteRoster,
  bulkUpdateRoster,
  getConfig,
  updateWorkday,
  updateGroup,
  generate,
  setLock,
  cancelLock,
  listLocks,
  getForemanTeam,
  setForemanMember,
  removeForemanMember,
};
