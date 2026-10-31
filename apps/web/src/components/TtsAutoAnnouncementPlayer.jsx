import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { portfolioRequest } from '../features/portfolio/client.mjs';

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

function LegacyAnnouncementPlayer({
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

export default function TtsAutoAnnouncementPlayer(props) {
  return props.zoneId ? <ZoneAnnouncementPlayer {...props}/> : <LegacyAnnouncementPlayer {...props}/>;
}

function ZoneAnnouncementPlayer({enabled=false,zoneId,playerId,pollIntervalMs=15000}) {
  const audioRef=useRef(null), retryRef=useRef(null), [status,setStatus]=useState('Player stopped'), [retry,setRetry]=useState(false);
  useEffect(()=>{
    const audio=audioRef.current, controller=new AbortController();let active=true,timer,expiryTimer,url,lease,started=false,ended=false,locked=false,retryLocked=false;
    const path=`/api/operations/voice/zones/${encodeURIComponent(zoneId)}`;
    const report=message=>{if(active)setStatus(message);};
    const command=(tail,body)=>portfolioRequest(`${path}/${tail}`,{body,signal:controller.signal});
    const pending=(message,fn)=>{if(!active)return;report(message);retryRef.current=()=>{if(retryLocked)return;retryLocked=true;Promise.resolve(fn()).finally(()=>{retryLocked=false;});};setRetry(true);};
    const clear=()=>{window.clearTimeout(expiryTimer);if(url){URL.revokeObjectURL(url);url=null;}audio.pause();audio.removeAttribute('src');audio.load();lease=null;started=false;ended=false;};
    async function acknowledgePlayed(body) {
      try {await command('played',body);if(!active)return;clear();report('Playback confirmed');setRetry(false);retryRef.current=null;timer=window.setTimeout(poll,500);}
      catch(e){if(e.name!=='AbortError')pending('Playback ended; receipt is unconfirmed. Retry the same receipt.',()=>acknowledgePlayed(body));}
    }
    async function confirmStarted(body) {
      try {const result=await command('started',body);if(!active)return;lease.version=result.data.version;started=true;setRetry(false);retryRef.current=null;report('Playing zone announcement');
        if(ended)await acknowledgePlayed({expectedVersion:lease.version,idempotencyKey:crypto.randomUUID(),playerId,playbackToken:lease.playbackToken});}
      catch(e){if(e.name!=='AbortError')pending('Audio started; start receipt is unconfirmed. Retry the same receipt.',()=>confirmStarted(body));}
    }
    async function play() {
      if(!active || !lease || Date.parse(lease.playback.expiresAt)<=Date.now())return;
      try {await audio.play();if(!active){audio.pause();return;}setRetry(false);retryRef.current=null;
        if(!started)await confirmStarted({expectedVersion:lease.version,idempotencyKey:crypto.randomUUID(),playerId,playbackToken:lease.playbackToken});else report('Playing zone announcement');}
      catch(e){if(e.name!=='AbortError')pending(e.name==='NotAllowedError'?'Browser blocked autoplay. Start this announcement.':'Audio could not start. Retry this announcement.',play);}
    }
    async function loadAudio() {
      try {
        const base=(import.meta.env.VITE_PORTFOLIO_API_BASE || '/portfolio-api').replace(/\/$/,'');
        const response=await fetch(`${base}${lease.streamUrl}?playerId=${encodeURIComponent(playerId)}`,{credentials:'include',cache:'no-store',signal:controller.signal,headers:{'X-Playback-Token':lease.playbackToken}});
        if(!response.ok || !(response.headers.get('content-type')||'').startsWith('audio/'))throw new Error('AUDIO_UNAVAILABLE');
        const blob=await response.blob();if(!active)return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);audio.src=url;audio.load();await play();
      }catch(e){if(e.name!=='AbortError')pending('Verified audio is unavailable. Retry the current lease or recover it after expiry.',loadAudio);}
    }
    async function acquire(body) {
      try {const result=await command('lease',body);if(!active)return;lease=result.data;
        const remaining=Date.parse(lease.playback.expiresAt)-Date.now();if(remaining<=0){report('Player lease expired. Recover it in the zone workspace.');return;}
        expiryTimer=window.setTimeout(()=>{clear();report('Player lease expired. Recover it in the zone workspace.');setRetry(false);retryRef.current=null;},remaining);
        await loadAudio();
      }catch(e){if(e.name==='AbortError')return;if(e.status===404 || e.status===409){report(e.status===404?'No published audio':'Zone changed or another player owns it');timer=window.setTimeout(poll,Math.max(3000,pollIntervalMs));}else pending('Player lease result is unconfirmed. Retry the same request.',()=>acquire(body));}
    }
    async function poll() {
      if(!active || !enabled || locked || lease || document.hidden)return;
      locked=true;
      try {const result=await portfolioRequest(path,{signal:controller.signal});if(!active)return;
        if(!result.data.active){report('Zone disabled');return;}
        if(result.data.playback){report('A player lease is active. Recover it after expiry if playback stopped.');timer=window.setTimeout(poll,Math.max(3000,pollIntervalMs));return;}
        await acquire({expectedVersion:result.data.version,idempotencyKey:crypto.randomUUID(),playerId});
      }catch(e){if(e.name!=='AbortError')pending('Zone could not load. Retry to read the current state.',poll);}
      finally{locked=false;}
    }
    const onEnded=()=>{if(ended)return;ended=true;if(started && lease)acknowledgePlayed({expectedVersion:lease.version,idempotencyKey:crypto.randomUUID(),playerId,playbackToken:lease.playbackToken});};
    const onError=()=>{if(lease)pending('Audio playback failed. Recover the lease after expiry; it has not been reported as played.',loadAudio);};
    const visible=()=>{if(!document.hidden && !lease)poll();};
    audio.addEventListener('ended',onEnded);audio.addEventListener('error',onError);document.addEventListener('visibilitychange',visible);
    if(enabled && playerId)poll();
    return()=>{active=false;controller.abort();window.clearTimeout(timer);window.clearTimeout(expiryTimer);audio.removeEventListener('ended',onEnded);audio.removeEventListener('error',onError);document.removeEventListener('visibilitychange',visible);retryRef.current=null;clear();};
  },[enabled,zoneId,playerId,pollIntervalMs]);
  return <div><audio ref={audioRef} preload="none"/><p role="status">{enabled?status:'Player stopped'}</p>{enabled && retry && <button type="button" onClick={()=>retryRef.current?.()}>Retry current player action</button>}</div>;
}
