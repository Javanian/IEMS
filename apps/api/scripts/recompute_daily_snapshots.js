require('../config/loadEnv');
const { Pool, types } = require('pg');
const { resolveTimezone } = require('../config/timezone');

types.setTypeParser(1082, (str) => str);
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1184, (str) => str);

const TZ = resolveTimezone();

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--dates') args.dates = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function assertIso(d) {
  if (!ISO.test(String(d || ''))) throw new Error(`Bad date (want YYYY-MM-DD): ${d}`);
}
function eachDate(from, to) {
  assertIso(from);
  assertIso(to);
  const out = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (cur > end) throw new Error(`--from ${from} is after --to ${to}`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 2,
  application_name: 'mps2-recompute-daily-snapshots',
  options: `-c timezone=${TZ}`,
});
global.pool = pool;

const ewsCalculator = require('../services/ewsCalculator');

async function storedAdoption(date) {
  const { rows } = await pool.query(
    `SELECT adoption_pct,
            (SELECT k->>'value' FROM jsonb_array_elements(detail_json->'kpis') k
              WHERE k->>'key'='adoption_labour') AS labour_pct
       FROM ews.kpi_snapshot
      WHERE scope_type='system' AND grain='today'
        AND (window_start AT TIME ZONE $2)::date = $1::date
      ORDER BY calculated_at DESC LIMIT 1`,
    [date, TZ]
  );
  return rows[0] || null;
}

async function main() {
  if (!process.argv.includes('--i-know-this-is-unsafe')) {
    throw new Error(
      'UNSAFE — refusing to run. A whole-row recompute nulls adoption_machine/uptime_tablet and drifts ' +
        'accuracy_*/ole for past dates. Use scripts/patch_adoption_labour_snapshot.js instead. ' +
        '(Override for diagnostics only: --i-know-this-is-unsafe)'
    );
  }
  const args = parseArgs(process.argv.filter((a) => a !== '--i-know-this-is-unsafe'));
  let dates;
  if (args.dates)
    dates = args.dates
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  else if (args.from && args.to) dates = eachDate(args.from, args.to);
  else throw new Error('Provide --from/--to or --dates');
  dates.forEach(assertIso);

  const { rows: t } = await pool.query(`SELECT (now() AT TIME ZONE $1)::date::text AS today`, [TZ]);
  const today = t[0].today;
  const past = dates.filter((d) => d < today);
  const skipped = dates.filter((d) => d >= today);
  if (skipped.length)
    console.warn(`[recompute] skipping today/future (owned by live job): ${skipped.join(', ')}`);

  console.log(
    `[recompute] ${args.dryRun ? 'DRY-RUN' : 'WRITE'} · TZ=${TZ} · ${past.length} date(s)`
  );
  for (const date of past) {
    const before = await storedAdoption(date);
    const payload = await ewsCalculator.calculateSystemSummary({
      basis: 'date',
      date,
      persistDaily: !args.dryRun,
    });
    const labour = payload.kpis.find((k) => k.key === 'adoption_labour');
    const after = labour ? labour.value : null;
    console.log(
      `[recompute] ${date} labour_adoption: stored=${before?.labour_pct ?? '—'} -> recomputed=${after ?? '—'}` +
        (args.dryRun ? '  (dry-run, not written)' : '  (written)')
    );
  }
  console.log(`[recompute] done (${args.dryRun ? 'no writes' : 'written'}).`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[recompute] failed:', err.message);
    await pool.end().catch(() => {});
    process.exit(1);
  });
