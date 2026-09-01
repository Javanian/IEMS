process.env.TIMEZONE = process.env.TIMEZONE || 'Asia/Makassar';

let scenario = {};
const pgErr = (code, message) => Object.assign(new Error(message || code), { code });

global.pool = {
  async query(sql) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('AS week_start_dow') && s.includes('operator_exists')) {
      if (scenario.preflightError) throw scenario.preflightError;
      return { rows: [scenario.preflight], rowCount: 1 };
    }
    if (s.includes('INSERT INTO ews.operator_shift_lock')) {
      if (scenario.insertError) throw scenario.insertError;
      return { rows: [scenario.insertRow], rowCount: 1 };
    }
    if (s.startsWith('UPDATE ews.operator_shift_lock')) {
      if (scenario.cancelError) throw scenario.cancelError;
      return { rows: scenario.cancelRows || [], rowCount: (scenario.cancelRows || []).length };
    }
    if (s.includes('already_cancelled') && s.includes('already_started')) {
      return { rows: scenario.diagRows || [], rowCount: (scenario.diagRows || []).length };
    }
    if (s.includes('FROM ews.operator_shift_lock') && s.includes('active_now')) {
      if (scenario.listError) throw scenario.listError;
      return { rows: scenario.listRows || [], rowCount: (scenario.listRows || []).length };
    }
    throw new Error('UNMOCKED QUERY: ' + s.slice(0, 100));
  },
};

const express = require('express');
const roster = require('../controllers/ewsRosterController');

const app = express();
app.use(express.json());
app.post('/ews/roster/lock', roster.setLock);
app.post('/ews/roster/lock/:id/cancel', roster.cancelLock);
app.get('/ews/roster/locks', roster.listLocks);

const OK_PF = { week_start_dow: 0, not_historical: true, operator_exists: true };
const LOCK_ROW = {
  id: 1,
  serialnumber: '11000417',
  locked_shift: 'DAY',
  effective_from: '2026-07-28',
  lock_weeks: 2,
  lock_end: '2026-08-09',
  created_by: 't',
  created_at: '2026-07-21T00:00:00Z',
};

const cases = [
  {
    name: 'set happy',
    expect: { status: 200, bodyHas: ['data', 'lock_end'] },
    scen: { preflight: OK_PF, insertRow: LOCK_ROW },
    req: {
      method: 'POST',
      path: '/ews/roster/lock',
      body: {
        serialnumber: '11000417',
        locked_shift: 'DAY',
        effective_from: '2026-07-28',
        lock_weeks: 2,
      },
    },
  },
  {
    name: 'set overlap -> 409',
    expect: { status: 409 },
    scen: {
      preflight: OK_PF,
      insertError: pgErr(
        '23P01',
        'conflicting key value violates exclusion constraint "operator_shift_lock_no_overlap"'
      ),
    },
    req: {
      method: 'POST',
      path: '/ews/roster/lock',
      body: {
        serialnumber: '11000417',
        locked_shift: 'DAY',
        effective_from: '2026-07-28',
        lock_weeks: 2,
      },
    },
  },
  {
    name: 'set shift invalid -> 400',
    expect: { status: 400 },
    scen: {},
    req: {
      method: 'POST',
      path: '/ews/roster/lock',
      body: {
        serialnumber: '11000417',
        locked_shift: 'SWING',
        effective_from: '2026-07-28',
        lock_weeks: 2,
      },
    },
  },
  {
    name: 'set lock_weeks<=0 -> 400',
    expect: { status: 400 },
    scen: {},
    req: {
      method: 'POST',
      path: '/ews/roster/lock',
      body: {
        serialnumber: '11000417',
        locked_shift: 'DAY',
        effective_from: '2026-07-28',
        lock_weeks: 0,
      },
    },
  },
  {
    name: 'set historical -> 400',
    expect: { status: 400 },
    scen: { preflight: { week_start_dow: 0, not_historical: false, operator_exists: true } },
    req: {
      method: 'POST',
      path: '/ews/roster/lock',
      body: {
        serialnumber: '11000417',
        locked_shift: 'DAY',
        effective_from: '2026-01-01',
        lock_weeks: 2,
      },
    },
  },
  {
    name: 'set operator missing -> 404',
    expect: { status: 404 },
    scen: { preflight: { week_start_dow: 0, not_historical: true, operator_exists: false } },
    req: {
      method: 'POST',
      path: '/ews/roster/lock',
      body: {
        serialnumber: 'ZZZ',
        locked_shift: 'DAY',
        effective_from: '2026-07-28',
        lock_weeks: 2,
      },
    },
  },
  {
    name: 'set table missing 42P01 -> 503',
    expect: { status: 503 },
    scen: {
      preflight: OK_PF,
      insertError: pgErr('42P01', 'relation "ews.operator_shift_lock" does not exist'),
    },
    req: {
      method: 'POST',
      path: '/ews/roster/lock',
      body: {
        serialnumber: '11000417',
        locked_shift: 'DAY',
        effective_from: '2026-07-28',
        lock_weeks: 2,
      },
    },
  },
  {
    name: 'set FK 23503 -> 400',
    expect: { status: 400 },
    scen: {
      preflight: OK_PF,
      insertError: pgErr('23503', 'insert or update on table violates foreign key constraint'),
    },
    req: {
      method: 'POST',
      path: '/ews/roster/lock',
      body: {
        serialnumber: '11000417',
        locked_shift: 'NIGHT',
        effective_from: '2026-07-28',
        lock_weeks: 2,
      },
    },
  },

  {
    name: 'cancel happy -> 200',
    expect: { status: 200, bodyHas: ['cancelled_at'] },
    scen: {
      cancelRows: [
        {
          id: 5,
          serialnumber: '11000417',
          locked_shift: 'DAY',
          effective_from: '2026-07-28',
          lock_end: '2026-08-09',
          cancelled_at: '2026-07-21T00:00:00Z',
        },
      ],
    },
    req: { method: 'POST', path: '/ews/roster/lock/5/cancel' },
  },
  {
    name: 'cancel already-started -> 400',
    expect: { status: 400 },
    scen: { cancelRows: [], diagRows: [{ already_cancelled: false, already_started: true }] },
    req: { method: 'POST', path: '/ews/roster/lock/6/cancel' },
  },
  {
    name: 'cancel not found -> 404',
    expect: { status: 404 },
    scen: { cancelRows: [], diagRows: [] },
    req: { method: 'POST', path: '/ews/roster/lock/999/cancel' },
  },
  {
    name: 'cancel already-cancelled -> 409',
    expect: { status: 409 },
    scen: { cancelRows: [], diagRows: [{ already_cancelled: true, already_started: false }] },
    req: { method: 'POST', path: '/ews/roster/lock/7/cancel' },
  },

  {
    name: 'GET locks active -> 200',
    expect: { status: 200, bodyHas: ['data'] },
    scen: {
      listRows: [
        {
          id: 1,
          serialnumber: '11000417',
          locked_shift: 'DAY',
          effective_from: '2026-07-28',
          lock_weeks: 2,
          lock_end: '2026-08-09',
          created_by: 't',
          created_at: 'x',
          cancelled_at: null,
          active_now: true,
        },
      ],
    },
    req: { method: 'GET', path: '/ews/roster/locks' },
  },
  {
    name: 'GET locks ?all=1 -> 200',
    expect: { status: 200, bodyHas: ['data'] },
    scen: { listRows: [] },
    req: { method: 'GET', path: '/ews/roster/locks?all=1' },
  },
];

const PORT = 3999;

(async () => {
  const server = app.listen(PORT);
  await new Promise((r) => server.once('listening', r));
  let pass = 0,
    fail = 0;
  const out = [];
  for (const c of cases) {
    scenario = c.scen || {};
    let status, body;
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}${c.req.path}`, {
        method: c.req.method,
        headers: c.req.body ? { 'Content-Type': 'application/json' } : {},
        body: c.req.body ? JSON.stringify(c.req.body) : undefined,
      });
      status = res.status;
      body = await res.json().catch(() => ({}));
    } catch (e) {
      status = 'ERR';
      body = { error: e.message };
    }
    let ok = status === c.expect.status;
    if (ok && c.expect.bodyHas) {
      const flat = JSON.stringify(body);
      ok = c.expect.bodyHas.every((k) => flat.includes(`"${k}"`));
    }
    ok ? pass++ : fail++;
    out.push({ ok, name: c.name, exp: c.expect.status, act: status, body: JSON.stringify(body) });
  }
  server.close();
  console.log('=== Shift-lock HTTP contract (real handlers, mock DB) ===');
  for (const r of out)
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(30)} exp=${String(r.exp).padEnd(4)} act=${String(r.act).padEnd(4)} ${r.body}`
    );
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
