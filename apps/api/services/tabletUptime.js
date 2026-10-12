// Uptime Tablet: how much of the time each shop-floor tablet was reachable, measured from the
// heartbeats the kiosk app sends (POST /device-heartbeat, one beat every interval_sec).
//
// Heartbeats are stored as a count per device per local calendar day
// (ews.device_heartbeat_daily), so the uptime of a day is known but not when inside the day the
// beats arrived. Each day the window touches contributes in proportion to its overlap:
//
//   day ratio (device, day) = MIN(beats / (day seconds elapsed / interval_sec), 1)
//   expected beats          = seconds of the window inside that day / interval_sec
//   received beats          = expected beats * day ratio
//   uptime                  = SUM(received) / SUM(expected) across the fleet
//
// "Day seconds elapsed" runs from local midnight (or the device's first heartbeat) to the end of
// the day, or to now for today. A rolling 24 h window therefore weighs yesterday and today by how
// many of its hours fall on each.
//
// The fleet is every device that sent a heartbeat within EWS_TABLET_ACTIVE_DAYS before the
// window, so a tablet that stops beating keeps counting as down until it is retired. Days before
// a device's first heartbeat (device_status.created_at) are not expected.

const db = global.pool || require('../db');
const { resolveTimezone } = require('../config/timezone');

const ACTIVE_DAYS = Number(process.env.EWS_TABLET_ACTIVE_DAYS || 7);
const ONLINE_MISSED_BEATS = 3;

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Aggregate per-device-per-day rows into the KPI.
 * rows: [{ device_id, device_name, model, app_version, battery_pct, charging, last_seen, online,
 *          work_date, day_seconds, window_seconds, beats, interval_sec }]
 * window_seconds defaults to day_seconds (whole-day windows).
 */
function summarizeTabletUptime(rows) {
  const byDevice = new Map();
  for (const row of rows) {
    let device = byDevice.get(row.device_id);
    if (!device) {
      device = {
        device_id: row.device_id,
        device_name: row.device_name || null,
        model: row.model || null,
        app_version: row.app_version || null,
        battery_pct: row.battery_pct ?? null,
        charging: Boolean(row.charging),
        last_seen: row.last_seen || null,
        online: Boolean(row.online),
        beats: 0,
        expected_beats: 0,
        received_beats: 0,
      };
      byDevice.set(row.device_id, device);
    }
    const interval = Math.max(Number(row.interval_sec) || 60, 1);
    const daySeconds = Math.max(Number(row.day_seconds) || 0, 0);
    const windowSeconds = Math.max(Number(row.window_seconds ?? row.day_seconds) || 0, 0);
    const beats = Math.max(Number(row.beats) || 0, 0);
    const dayExpected = daySeconds / interval;
    const ratio = dayExpected > 0 ? Math.min(beats / dayExpected, 1) : 0;
    const expected = Math.min(windowSeconds, daySeconds) / interval;
    device.beats += beats;
    device.expected_beats += expected;
    device.received_beats += expected * ratio;
  }

  const devices = [...byDevice.values()]
    .filter((d) => d.expected_beats > 0)
    .map((d) => ({
      ...d,
      expected_beats: Math.round(d.expected_beats),
      received_beats: Math.round(d.received_beats),
      uptime_pct: round2((100 * d.received_beats) / d.expected_beats),
    }))
    .sort((a, b) => a.uptime_pct - b.uptime_pct || String(a.device_id).localeCompare(b.device_id));

  const expected = devices.reduce((s, d) => s + d.expected_beats, 0);
  const received = devices.reduce((s, d) => s + d.received_beats, 0);
  const online = devices.filter((d) => d.online).length;
  const value = expected > 0 ? round2((100 * received) / expected) : null;

  return {
    value,
    helper:
      value === null
        ? 'Belum ada tablet yang mengirim heartbeat'
        : `${online}/${devices.length} tablet online saat ini`,
    detail: {
      device_count: devices.length,
      devices_online: online,
      devices_offline: devices.length - online,
      expected_beats: expected,
      received_beats: received,
      devices,
      method:
        'SUM(received heartbeats, capped per device-day) / SUM(expected heartbeats) across the fleet',
      numerator:
        'expected beats * MIN(beats stored for the day / beats expected for the elapsed day, 1)',
      denominator: 'seconds of the window per local day (from the first heartbeat on), / interval_sec',
      granularity: 'local calendar day, weighted by window overlap',
      active_days: ACTIVE_DAYS,
    },
  };
}

async function fetchTabletRows(bounds) {
  const timezone = resolveTimezone();
  const { rows } = await db.query(
    `
    WITH ref AS (
      SELECT $1::timestamptz AS ws, LEAST($2::timestamptz, now()) AS we
    ),
    days AS (
      SELECT d::date AS work_date,
             (d::date)::timestamp AT TIME ZONE $3 AS day_start,
             LEAST((d::date + 1)::timestamp AT TIME ZONE $3, now()) AS day_end,
             ref.ws, ref.we
      FROM ref,
           generate_series((ws AT TIME ZONE $3)::date, (we AT TIME ZONE $3)::date, interval '1 day') d
      WHERE ws < we
    ),
    fleet AS (
      SELECT s.*
      FROM public.device_status s, ref
      WHERE s.last_seen >= ref.ws - make_interval(days => $4::int)
        AND s.created_at < ref.we
    )
    SELECT f.device_id, f.device_name, f.model, f.app_version, f.battery_pct, f.charging,
           f.last_seen,
           (now() - f.last_seen) < make_interval(secs => f.interval_sec * $5::int) AS online,
           dy.work_date::text AS work_date,
           GREATEST(EXTRACT(EPOCH FROM (dy.day_end - GREATEST(dy.day_start, f.created_at))), 0)::float
             AS day_seconds,
           GREATEST(EXTRACT(EPOCH FROM (
             LEAST(dy.day_end, dy.we) - GREATEST(dy.day_start, dy.ws, f.created_at)
           )), 0)::float AS window_seconds,
           COALESCE(h.beats, 0)::float AS beats,
           COALESCE(h.interval_sec, f.interval_sec) AS interval_sec
    FROM fleet f
    CROSS JOIN days dy
    LEFT JOIN ews.device_heartbeat_daily h
      ON h.device_id = f.device_id AND h.work_date = dy.work_date
    ORDER BY f.device_id, dy.work_date
    `,
    [bounds.window_start, bounds.window_end, timezone, ACTIVE_DAYS, ONLINE_MISSED_BEATS]
  );
  return rows;
}

async function calculateUptimeTablet(bounds, { tableExists }) {
  const ready =
    (await tableExists('public', 'device_status')) &&
    (await tableExists('ews', 'device_heartbeat_daily'));
  if (!ready) {
    return {
      value: null,
      helper: 'Tabel heartbeat tablet belum tersedia (jalankan migrasi device_heartbeat)',
      detail: { source: 'no_table', device_count: 0, devices: [] },
    };
  }
  if (!bounds?.window_start || !bounds?.window_end) {
    return { value: null, helper: 'No window', detail: { device_count: 0, devices: [] } };
  }
  return summarizeTabletUptime(await fetchTabletRows(bounds));
}

module.exports = { calculateUptimeTablet, summarizeTabletUptime };
