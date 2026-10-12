import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

const TTS_API_BASE = import.meta.env.VITE_TTS_API_URL || '';
const DEFAULT_POLL_INTERVAL_MS = 15000;
const BLOCKED_RETRY_MS = 30000;
const ERROR_RETRY_MS = 45000;

function ttsUrl(path) {
  return `${TTS_API_BASE.replace(/\/$/, '')}${path}`;
}

async function fetchAudioCandidate() {
  const response = await fetch(ttsUrl(`/tts/audio/pending?t=${Date.now()}`), {
    cache: 'no-store',
  });

  if (response.status === 404 || response.status === 422) {
    const legacyResponse = await fetch(ttsUrl(`/tts/audio/next?t=${Date.now()}`), {
      cache: 'no-store',
    });

    if (legacyResponse.status === 404) return null;

    if (!legacyResponse.ok) {
      throw new Error(`Gagal ambil audio legacy: HTTP ${legacyResponse.status}`);
    }

    const contentType = legacyResponse.headers.get('content-type') || '';
    if (!contentType.includes('audio')) {
      throw new Error(`Response bukan audio: ${contentType || '-'}`);
    }

    const blob = await legacyResponse.blob();
    return {
      id: null,
      objectUrl: URL.createObjectURL(blob),
    };
  }

  if (!response.ok) {
    throw new Error(`Gagal cek audio pending: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const pending = payload.data;
  if (!pending?.id) return null;

  return {
    id: pending.id,
    objectUrl: null,
    streamUrl: ttsUrl(`/tts/audio/${pending.id}/stream?t=${Date.now()}`),
  };
}

async function markAudioPlayed(id) {
  await fetch(ttsUrl(`/tts/audio/${id}/played`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export default function TtsAutoAnnouncementPlayer({
  enabled = true,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}) {
  const audioRef = useRef(null);
  const currentIdRef = useRef(null);
  const isPlayingRef = useRef(false);
  const isCheckingRef = useRef(false);
  const blockedToastShownRef = useRef(false);
  const retryTimerRef = useRef(null);
  const playPendingAudioRef = useRef(null);
  const objectUrlRef = useRef(null);

  const scheduleRetry = useCallback((delayMs = ERROR_RETRY_MS) => {
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(() => {
      playPendingAudioRef.current?.();
    }, delayMs);
  }, []);

  const playPendingAudio = useCallback(async () => {
    if (!enabled || document.hidden || isPlayingRef.current || isCheckingRef.current) return;

    const audio = audioRef.current;
    if (!audio) return;

    isCheckingRef.current = true;

    try {
      const pending = await fetchAudioCandidate();
      if (!pending) return;

      currentIdRef.current = pending.id;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }

      if (pending.objectUrl) {
        objectUrlRef.current = pending.objectUrl;
      }

      audio.src = pending.objectUrl || pending.streamUrl;
      audio.load();

      await audio.play();
      isPlayingRef.current = true;
      blockedToastShownRef.current = false;
    } catch (error) {
      isPlayingRef.current = false;

      if (error?.name === 'NotAllowedError' && !blockedToastShownRef.current) {
        blockedToastShownRef.current = true;
        toast.warning(
          'Autoplay audio diblok browser. Izinkan autoplay untuk site ini agar TTS bisa jalan otomatis.'
        );
        scheduleRetry(BLOCKED_RETRY_MS);
        return;
      }

      scheduleRetry();
    } finally {
      isCheckingRef.current = false;
    }
  }, [enabled, scheduleRetry]);

  useEffect(() => {
    playPendingAudioRef.current = playPendingAudio;
  }, [playPendingAudio]);

  const handleEnded = useCallback(async () => {
    const playedId = currentIdRef.current;
    isPlayingRef.current = false;
    currentIdRef.current = null;

    if (playedId) {
      await markAudioPlayed(playedId).catch(() => {});
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    window.setTimeout(() => playPendingAudioRef.current?.(), 500);
  }, []);

  const handlePlaybackError = useCallback(() => {
    isPlayingRef.current = false;
    scheduleRetry();
  }, [scheduleRetry]);

  useEffect(() => {
    if (!enabled) return undefined;

    playPendingAudio();
    const interval = window.setInterval(playPendingAudio, pollIntervalMs);

    const retryAfterBrowserUnlock = () => playPendingAudio();
    const retryAfterVisible = () => {
      if (!document.hidden) playPendingAudio();
    };

    window.addEventListener('pointerdown', retryAfterBrowserUnlock, { capture: true });
    window.addEventListener('keydown', retryAfterBrowserUnlock, { capture: true });
    document.addEventListener('visibilitychange', retryAfterVisible);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(retryTimerRef.current);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      window.removeEventListener('pointerdown', retryAfterBrowserUnlock, { capture: true });
      window.removeEventListener('keydown', retryAfterBrowserUnlock, { capture: true });
      document.removeEventListener('visibilitychange', retryAfterVisible);
    };
  }, [enabled, playPendingAudio, pollIntervalMs]);

  return (
    <audio
      ref={audioRef}
      preload="none"
      className="hidden"
      onEnded={handleEnded}
      onError={handlePlaybackError}
    />
  );
}
