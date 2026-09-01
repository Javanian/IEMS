import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSowOrdersPage } from '../../services/msProjectService';
import { weekEndText } from './constants';

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 250;

export const ORDER_TABS = [
  { id: 'perlu', label: 'To schedule' },
  { id: 'belum_jadwal', label: 'No MSP task' },
  { id: 'terjadwal', label: 'Scheduled' },
  { id: 'selesai', label: 'Completed' },
];

export const DEFAULT_ORDER_TAB = 'perlu';

const TAB_COMPLETION = {
  perlu: 'unfinished',
  belum_jadwal: 'unfinished',
  terjadwal: undefined,
  selesai: 'finished',
};

const TAB_PREDICATE = {
  perlu: (order) => Boolean(order.is_unfinished) && Boolean(order.has_msp_task),
  belum_jadwal: (order) => Boolean(order.is_unfinished) && !order.has_msp_task,
  terjadwal: (order) => Number(order.active_reservations || 0) > 0,
  selesai: (order) => !order.is_unfinished,
};

function buildParams(tab, search, offset) {
  const params = {
    exclude_unknown: 'true',
    limit: PAGE_SIZE,
    offset,

    counts: 'true',
    counts_due_by: weekEndText(),
  };
  const completion = TAB_COMPLETION[tab];
  if (completion) params.completion = completion;

  if (tab === 'perlu') params.due_by = weekEndText();
  const q = String(search || '').trim();
  if (q) params.q = q;
  return params;
}

const COUNT_PAGE_CAP = 20;

async function fetchTabCounts(search, signal) {
  const counts = {};
  for (const tab of ORDER_TABS) {
    const predicate = TAB_PREDICATE[tab.id];
    let matched = 0;
    let offset = 0;
    for (let pageIndex = 0; pageIndex < COUNT_PAGE_CAP; pageIndex += 1) {
      const params = buildParams(tab.id, search, offset);
      delete params.counts;
      delete params.counts_due_by;
      const page = await fetchSowOrdersPage(params, { signal });
      const rows = Array.isArray(page.rows) ? page.rows : [];
      matched += predicate ? rows.filter(predicate).length : rows.length;
      offset += rows.length;
      if (offset >= Number(page.total)) break;
    }
    counts[tab.id] = matched;
  }
  return counts;
}

export default function useSowOrders() {
  const [rows, setRows] = useState([]);
  const [serverTotal, setServerTotal] = useState(0);

  const [tabCounts, setTabCounts] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState(DEFAULT_ORDER_TAB);
  const [reloadToken, setReloadToken] = useState(0);

  const listAbortRef = useRef(null);
  const moreAbortRef = useRef(null);

  const stateRef = useRef({
    rows: [],
    serverTotal: 0,
    search: '',
    tab: DEFAULT_ORDER_TAB,
    busy: true,
  });

  useEffect(() => {
    stateRef.current = { rows, serverTotal, search, tab, busy: loading };
  }, [rows, serverTotal, search, tab, loading]);

  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      listAbortRef.current?.abort();
      listAbortRef.current = controller;

      moreAbortRef.current?.abort();
      moreAbortRef.current = null;
      setLoadingMore(false);
      setLoading(true);
      setError('');

      fetchSowOrdersPage(buildParams(tab, search, 0), { signal: controller.signal })
        .then((page) => {
          if (controller.signal.aborted) return;

          setRows(page.rows);
          setServerTotal(page.total);

          if (page.counts) {
            setTabCounts(page.counts);
            return;
          }
          fetchTabCounts(search, controller.signal)
            .then((counts) => {
              if (!controller.signal.aborted) setTabCounts(counts);
            })
            .catch(() => {});
        })
        .catch((err) => {
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          setError(err?.message || 'Failed to load orders.');
        })
        .finally(() => {
          if (listAbortRef.current === controller) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, tab, reloadToken]);

  useEffect(
    () => () => {
      listAbortRef.current?.abort();
      moreAbortRef.current?.abort();
    },
    []
  );

  const loadMore = useCallback(async () => {
    const snapshot = stateRef.current;
    if (snapshot.busy || moreAbortRef.current) return;
    if (snapshot.rows.length >= snapshot.serverTotal) return;

    const controller = new AbortController();
    moreAbortRef.current = controller;
    setLoadingMore(true);
    setError('');

    try {
      const page = await fetchSowOrdersPage(
        buildParams(snapshot.tab, snapshot.search, snapshot.rows.length),
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;

      setRows((prev) => {
        const seen = new Set(prev.map((row) => row.order_no));
        return [...prev, ...page.rows.filter((row) => !seen.has(row.order_no))];
      });
      setServerTotal(page.total);
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      setError(err?.message || 'Failed to load more orders.');
    } finally {
      if (moreAbortRef.current === controller) {
        moreAbortRef.current = null;
        setLoadingMore(false);
      }
    }
  }, []);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const orders = useMemo(() => {
    const predicate = TAB_PREDICATE[tab];
    return predicate ? rows.filter(predicate) : rows;
  }, [rows, tab]);

  const exhausted = rows.length >= serverTotal;
  const shown = orders.length;
  const total = exhausted ? shown : serverTotal;

  return {
    orders,
    total,
    shown,
    loading,
    error,
    reload,
    search,
    setSearch,
    tab,
    setTab,
    loadMore,
    tabCounts,

    loadingMore,
    hasMore: !exhausted,
  };
}
