import { useState, useEffect, useRef, useCallback } from 'react';

function isLocalDev() {
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function getWsUrl(interval) {
  if (isLocalDev()) {
    return `ws://localhost:3001/dashboard/ws?interval=${interval}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/dashboard/ws?interval=${interval}`;
}

export default function useDashboardWebSocket(initialInterval = 30000) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const intervalRef = useRef(initialInterval);
  const mountedRef = useRef(true);
  const connectFnRef = useRef(null);

  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    )
      return;

    const url = getWsUrl(intervalRef.current);
    const ws = new WebSocket(url);

    wsRef.current = ws;

    ws.onopen = () => {
      if (mountedRef.current) {
        setConnected(true);
        setError(null);
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot') {
          setData(message.data);
        } else if (message.type === 'error') {
          setError(message.error);
        }
      } catch (_e) {
        setError('Failed to parse WebSocket message');
      }
    };

    ws.onclose = () => {
      if (mountedRef.current) {
        setConnected(false);
        setTimeout(() => {
          if (mountedRef.current && connectFnRef.current) connectFnRef.current();
        }, 3000);
      }
    };

    ws.onerror = (_e) => {
      ws.close();
    };
  }, []);

  connectFnRef.current = connect;

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const refresh = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'refresh' }));
    }
  }, []);

  return { data, connected, error, refresh };
}
