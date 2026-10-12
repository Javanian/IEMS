import { useEffect } from 'react';

// Heartbeat for shop-floor kiosk tablets, feeding the "Uptime Tablet" EWS KPI.
//
// Only enrolled devices send it, so office desktops never count toward tablet uptime. A tablet is
// enrolled once by opening the app with ?kiosk=<name> (stored on the device); ?kiosk=off removes it.
// The server counts beats per device per day and compares them with the beats expected for the
// time elapsed, so a tablet that is off, asleep, offline or has the app closed loses uptime.

const STORAGE_KEY = 'iems.kioskDevice';
const INTERVAL_SEC = 60;
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const TOKEN = import.meta.env.VITE_DEVICE_HEARTBEAT_TOKEN || '';

// Module level, so a remount (StrictMode, route changes) cannot send an extra beat.
let lastSent = 0;

function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readDevice() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

/** Apply ?kiosk=<name> / ?kiosk=off and return the enrolled device, or null. */
export function syncKioskEnrollment(search = window.location.search) {
  const requested = new URLSearchParams(search).get('kiosk');
  let device = readDevice();
  try {
    if (requested === 'off') {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (requested) {
      const name = requested.trim().slice(0, 100);
      device = { id: device?.id || randomId(), name };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(device));
    }
  } catch {
    // Storage blocked: the device cannot be enrolled, so it sends nothing.
    return null;
  }
  return device?.id ? device : null;
}

async function batteryInfo() {
  try {
    const battery = await navigator.getBattery?.();
    if (!battery) return {};
    return { battery_pct: Math.round(battery.level * 100), charging: battery.charging };
  } catch {
    return {};
  }
}

async function sendBeat(device) {
  const android = /Android\s([\d.]+)/.exec(navigator.userAgent)?.[1] || null;
  const body = {
    device_id: device.id,
    device_name: device.name,
    app_version: import.meta.env.VITE_APP_VERSION || null,
    android_version: android,
    interval_sec: INTERVAL_SEC,
    ...(await batteryInfo()),
  };
  await fetch(`${API_BASE}/device-heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-token': TOKEN },
    body: JSON.stringify(body),
    keepalive: true,
  });
}

export default function useDeviceHeartbeat() {
  useEffect(() => {
    const device = syncKioskEnrollment();
    if (!device || !TOKEN) return undefined;

    const beat = () => {
      // Never send more than one beat per interval, whatever triggered it, so the server
      // count stays an honest measure of time online.
      if (Date.now() - lastSent < (INTERVAL_SEC - 5) * 1000) return;
      lastSent = Date.now();
      sendBeat(device).catch(() => {
        // Offline: the missing beat is exactly what the KPI should record.
      });
    };

    beat();
    const timer = setInterval(beat, INTERVAL_SEC * 1000);
    const onVisible = () => document.visibilityState === 'visible' && beat();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
