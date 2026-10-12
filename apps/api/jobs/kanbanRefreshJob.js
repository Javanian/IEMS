function parseIntervalMs() {
  const configured = Number(process.env.KANBAN_REFRESH_INTERVAL_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(configured, 60000);
  }
  return 300000;
}

function isEnabled() {
  return String(process.env.KANBAN_REFRESH_ENABLED || 'true').toLowerCase() !== 'false';
}

function startKanbanRefreshJob({ pool, logger = console } = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('pool is required to start kanban refresh job');
  }

  if (!isEnabled()) {
    logger.log('Kanban refresh job disabled');
    return null;
  }

  const intervalMs = parseIntervalMs();
  let isRefreshing = false;

  async function refresh() {
    if (isRefreshing) return;

    isRefreshing = true;
    const startedAt = Date.now();

    try {
      await pool.query('SELECT public.refresh_mv_kanban_order_board()');
      logger.log(`Kanban board refreshed in ${Date.now() - startedAt}ms`);
    } catch (err) {
      logger.warn(`Kanban board refresh failed: ${err.message}`);
    } finally {
      isRefreshing = false;
    }
  }

  const timer = setInterval(refresh, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  logger.log(`Kanban refresh job scheduled every ${Math.round(intervalMs / 1000)}s`);

  return {
    refresh,
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = {
  startKanbanRefreshJob,
};
