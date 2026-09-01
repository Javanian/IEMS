const { WebSocket, WebSocketServer } = require('ws');
const { fetchMachineHoursRows } = require('../controllers/machineHoursSqlServerController');

function paramsFromUrl(url) {
  const searchParams = new URL(url, 'http://localhost').searchParams;
  return Object.fromEntries(searchParams.entries());
}

function parseInterval(value) {
  const interval = parseInt(value, 10);
  if (!Number.isFinite(interval)) return 10000;
  return Math.min(60000, Math.max(3000, interval));
}

function initMachineHoursSqlServerSocket(wss) {
  wss.on('connection', (socket, request) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname !== '/machine-hours-sqlserver/ws') return;

    let filters = paramsFromUrl(request.url);
    let timer;

    const sendSnapshot = async () => {
      if (socket.readyState !== WebSocket.OPEN) return;

      try {
        const rows = await fetchMachineHoursRows(filters);
        socket.send(
          JSON.stringify({
            type: 'snapshot',
            data: rows,
            meta: {
              count: rows.length,
              generated_at: new Date().toISOString(),
            },
          })
        );
      } catch (err) {
        socket.send(
          JSON.stringify({
            type: 'error',
            error: err.message,
            generated_at: new Date().toISOString(),
          })
        );
      }
    };

    const startPolling = () => {
      clearInterval(timer);
      timer = setInterval(sendSnapshot, parseInterval(filters.interval));
    };

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'setFilters') {
          filters = { ...filters, ...(message.filters || {}) };
          startPolling();
          sendSnapshot();
        }
        if (message.type === 'refresh') {
          sendSnapshot();
        }
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid WebSocket message' }));
      }
    });

    socket.on('close', () => clearInterval(timer));
    socket.on('error', () => clearInterval(timer));

    sendSnapshot();
    startPolling();
  });
}

module.exports = initMachineHoursSqlServerSocket;
