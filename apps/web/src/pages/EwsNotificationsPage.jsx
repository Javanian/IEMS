import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Volume2, VolumeX, Play, CheckCircle2, RefreshCw } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const POLL_MS = 8000;

function severityBadge(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical') return 'bg-red-100 text-red-700 border-red-200';
  if (s === 'watch') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function formatTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EwsNotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [soundOn, setSoundOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const audioRef = useRef(null);
  const playingRef = useRef(false);
  const playedRef = useRef(new Set());

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ews/notifications?limit=20`);
      const json = await res.json();
      setItems(Array.isArray(json.data) ? json.data : []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    const t = setInterval(fetchItems, POLL_MS);
    return () => clearInterval(t);
  }, [fetchItems]);

  const markPlayed = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/ews/notifications/${id}/played`, { method: 'POST' });
    } catch {}
  }, []);

  const playNext = useCallback(async () => {
    if (!soundOn || playingRef.current) return;
    const next = items.find((it) => it.path_mp3 && !playedRef.current.has(it.id));
    if (!next) return;
    playingRef.current = true;
    playedRef.current.add(next.id);
    const audio = audioRef.current;
    if (!audio) {
      playingRef.current = false;
      return;
    }
    audio.src = next.path_mp3;
    try {
      await audio.play();
    } catch {
      playingRef.current = false;
      return;
    }
    audio.onended = async () => {
      playingRef.current = false;
      await markPlayed(next.id);
      setItems((prev) => prev.filter((x) => x.id !== next.id));
    };
  }, [soundOn, items, markPlayed]);

  useEffect(() => {
    playNext();
  }, [playNext, items, soundOn]);

  const playOne = useCallback(
    async (it) => {
      const audio = audioRef.current;
      if (!audio || !it.path_mp3) return;
      audio.src = it.path_mp3;
      try {
        await audio.play();
      } catch {}
      audio.onended = async () => {
        await markPlayed(it.id);
        setItems((prev) => prev.filter((x) => x.id !== it.id));
      };
    },
    [markPlayed]
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm md:px-6">
        <button
          type="button"
          onClick={() => navigate('/operations-hub')}
          className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-95"
        >
          <ArrowLeft size={16} /> Kembali
        </button>
        <h1 className="flex items-center gap-2 text-sm font-extrabold text-slate-800 md:text-base">
          <Bell size={18} className="text-[#0077b6]" /> Notifikasi EWS
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundOn((v) => !v)}
            className={`flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
              soundOn
                ? 'bg-[#0096c7] text-white hover:bg-[#0077b6]'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            title={
              soundOn
                ? 'Suara aktif — audio diputar otomatis'
                : 'Aktifkan suara agar audio diputar otomatis'
            }
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {soundOn ? 'Suara Aktif' : 'Aktifkan Suara'}
          </button>
          <button
            type="button"
            onClick={fetchItems}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 active:scale-95"
            title="Muat ulang"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4 md:py-6">
        {!soundOn && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-700">
            Browser memblokir audio otomatis sampai ada interaksi. Klik <b>Aktifkan Suara</b> sekali
            agar notifikasi berikutnya diputar otomatis.
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm font-semibold text-slate-400">
            Memuat notifikasi…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <p className="text-sm font-bold text-slate-600">
              Tidak ada notifikasi audio yang menunggu.
            </p>
            <p className="text-xs text-slate-400">
              Audio muncul di sini saat issue log EWS baru ter-generate.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${severityBadge(it.severity)}`}
                    >
                      {it.severity || 'Issue'}
                    </span>
                    <span className="text-sm font-bold text-slate-800">
                      {it.title || it.kpi_type}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-snug text-slate-600">{it.message}</p>
                  <p className="mt-1 text-[10px] font-semibold text-slate-400">
                    {formatTime(it.generated_at || it.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => playOne(it)}
                  className="flex min-h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center rounded-lg bg-[#0096c7] text-white transition hover:bg-[#0077b6] active:scale-95"
                  title="Putar audio"
                >
                  <Play size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {}
      <audio ref={audioRef} preload="none" />
    </div>
  );
}
