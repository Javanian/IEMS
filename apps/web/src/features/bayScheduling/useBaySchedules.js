import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchBaySchedules } from '../../services/msProjectService';
import { buildSchedulesByBay, dateKey, todayText } from './constants';

function clampCursor(value, rangeStart, rangeEnd) {
  let cursor = dateKey(value) || todayText();
  const from = dateKey(rangeStart);
  const to = dateKey(rangeEnd);
  if (from && cursor < from) cursor = from;
  if (to && cursor > to) cursor = to;

  if (from && to && to < from) cursor = from;
  return cursor;
}

export default function useBaySchedules({ rangeStart, rangeEnd } = {}) {
  const [reloadToken, setReloadToken] = useState(0);

  const [rawCursor, setRawCursor] = useState(todayText);

  const requestKey =
    rangeStart && rangeEnd ? `${dateKey(rangeStart)}|${dateKey(rangeEnd)}|${reloadToken}` : null;

  const [result, setResult] = useState({ key: null, rows: [], error: '' });

  const cursorDate = useMemo(
    () => clampCursor(rawCursor, rangeStart, rangeEnd),
    [rawCursor, rangeStart, rangeEnd]
  );

  useEffect(() => {
    if (!requestKey) return undefined;

    const controller = new AbortController();

    fetchBaySchedules({ start_date: rangeStart, end_date: rangeEnd }, { signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, rows: Array.isArray(rows) ? rows : [], error: '' });
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;

        setResult((prev) => ({
          key: requestKey,
          rows: prev.rows,
          error: err?.message || 'Failed to load bay schedules.',
        }));
      });

    return () => controller.abort();
  }, [requestKey, rangeStart, rangeEnd]);

  const schedules = result.rows;
  const loading = result.key !== requestKey;
  const error = loading ? '' : result.error;

  const byBay = useMemo(() => buildSchedulesByBay(schedules, cursorDate), [schedules, cursorDate]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return {
    schedules,
    byBay,
    loading,
    error,
    reload,
    cursorDate,
    setCursorDate: setRawCursor,
  };
}
