const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeTabletUptime } = require('./tabletUptime');

const day = (device_id, beats, day_seconds, extra = {}) => ({
  device_id,
  device_name: device_id,
  online: true,
  interval_sec: 60,
  work_date: '2026-10-13',
  day_seconds,
  beats,
  ...extra,
});

test('no tablets reporting gives no value instead of 100%', () => {
  const result = summarizeTabletUptime([]);
  assert.equal(result.value, null);
  assert.equal(result.detail.device_count, 0);
});

test('uptime is received / expected beats across the fleet', () => {
  // 10 hours expected at 60s = 600 beats each. A sent all, B sent half.
  const result = summarizeTabletUptime([
    day('TAB-A', 600, 36000),
    day('TAB-B', 300, 36000, { online: false }),
  ]);
  assert.equal(result.value, 75);
  assert.equal(result.detail.devices_online, 1);
  assert.equal(result.helper, '1/2 tablet online saat ini');
  // Worst device first.
  assert.deepEqual(
    result.detail.devices.map((d) => [d.device_id, d.uptime_pct]),
    [
      ['TAB-B', 50],
      ['TAB-A', 100],
    ]
  );
});

test('extra beats on one day cannot hide a missing day', () => {
  // Day 1: 2x the expected beats (app restarted twice). Day 2: silent.
  const result = summarizeTabletUptime([
    day('TAB-A', 2880, 86400, { work_date: '2026-10-12' }),
    day('TAB-A', 0, 86400, { work_date: '2026-10-13' }),
  ]);
  assert.equal(result.value, 50);
});

test('a tablet that never beat in the window counts as down', () => {
  const result = summarizeTabletUptime([day('TAB-A', 1440, 86400), day('TAB-SILENT', 0, 86400)]);
  assert.equal(result.value, 50);
  assert.equal(result.detail.devices.find((d) => d.device_id === 'TAB-SILENT').uptime_pct, 0);
});

test('days with no expected time are ignored', () => {
  const result = summarizeTabletUptime([day('TAB-NEW', 0, 0)]);
  assert.equal(result.value, null);
  assert.equal(result.detail.device_count, 0);
});

test('expected beats follow each device interval', () => {
  // 1 hour at 30s = 120 beats expected; 90 received.
  const result = summarizeTabletUptime([day('TAB-A', 90, 3600, { interval_sec: 30 })]);
  assert.equal(result.value, 75);
  assert.equal(result.detail.expected_beats, 120);
});

test('a partial day in the window counts by its overlap, using the day ratio', () => {
  // Rolling 24 h: 18 h of yesterday (perfect) and 6 h of today (tablet down all day so far).
  const result = summarizeTabletUptime([
    day('TAB-A', 1440, 86400, { work_date: '2026-10-12', window_seconds: 18 * 3600 }),
    day('TAB-A', 0, 6 * 3600, { work_date: '2026-10-13', window_seconds: 6 * 3600 }),
  ]);
  assert.equal(result.value, 75);
  assert.equal(result.detail.expected_beats, 1440);
});
