import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';

const TTS_API_BASE = import.meta.env.VITE_TTS_API_URL || '';

function ttsUrl(path) {
  return `${TTS_API_BASE.replace(/\/$/, '')}${path}`;
}

const TtsAudioTestPage = () => {
  const audioRef = useRef(null);
  const currentNotificationIdRef = useRef(null);
  const objectUrlRef = useRef('');
  const [message, setMessage] = useState('Ready');
  const [lastUrl, setLastUrl] = useState('');
  const [ssbrId, setSsbrId] = useState('A102');

  const setAudioBlob = useCallback(async (blob) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const nextObjectUrl = URL.createObjectURL(blob);
    objectUrlRef.current = nextObjectUrl;
    setLastUrl(nextObjectUrl);

    const audio = audioRef.current;
    if (!audio) return;

    audio.src = nextObjectUrl;
    audio.load();
    await audio.play();
  }, []);

  const readErrorMessage = async (response) => {
    try {
      const data = await response.json();
      return data.detail || data.error || `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  };

  const generateAudio = async () => {
    const cleaned = ssbrId.trim();
    if (!cleaned) {
      setMessage('SSBR ID wajib diisi');
      return;
    }

    setMessage('Generate audio...');
    try {
      const response = await fetch(ttsUrl('/tts/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssbr_id: cleaned }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = await response.json();
      setMessage(`Audio dibuat: ${data.path_mp3}`);
    } catch (err) {
      setMessage(`Generate gagal: ${err.message}`);
    }
  };

  const playNextAudio = useCallback(async () => {
    const pendingUrl = ttsUrl(`/tts/audio/pending?t=${Date.now()}`);
    setLastUrl(pendingUrl);
    setMessage('Cek audio pending...');

    try {
      const pendingResponse = await fetch(pendingUrl, { cache: 'no-store' });
      if (pendingResponse.status === 404 || pendingResponse.status === 422) {
        const legacyUrl = ttsUrl(`/tts/audio/next?t=${Date.now()}`);
        currentNotificationIdRef.current = null;
        setLastUrl(legacyUrl);
        setMessage('Mengambil audio dari endpoint lama...');

        const legacyResponse = await fetch(legacyUrl, { cache: 'no-store' });
        if (!legacyResponse.ok) {
          throw new Error(await readErrorMessage(legacyResponse));
        }

        const contentType = legacyResponse.headers.get('content-type') || '';
        if (!contentType.includes('audio')) {
          throw new Error(`Response bukan audio: ${contentType || '-'}`);
        }

        const blob = await legacyResponse.blob();
        await setAudioBlob(blob);
        setMessage('Audio sedang diputar');
        return;
      }

      if (!pendingResponse.ok) {
        throw new Error(await readErrorMessage(pendingResponse));
      }

      const pendingPayload = await pendingResponse.json();
      const pending = pendingPayload.data;
      if (!pending?.id) {
        setMessage('Tidak ada audio announcement yang pending');
        return;
      }

      currentNotificationIdRef.current = pending.id;
      const streamUrl = ttsUrl(`/tts/audio/${pending.id}/stream?t=${Date.now()}`);
      setLastUrl(streamUrl);
      setMessage(`Mengambil audio id ${pending.id}...`);

      const response = await fetch(streamUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('audio')) {
        throw new Error(`Response bukan audio: ${contentType || '-'}`);
      }

      const blob = await response.blob();
      await setAudioBlob(blob);
      setMessage('Audio sedang diputar');
    } catch (err) {
      setMessage(`Tidak bisa play audio: ${err.message}`);
    }
  }, [setAudioBlob]);

  const markCurrentAudioPlayed = useCallback(async () => {
    const id = currentNotificationIdRef.current;
    currentNotificationIdRef.current = null;
    if (!id) return;

    await fetch(ttsUrl(`/tts/audio/${id}/played`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  }, []);

  useEffect(() => {
    playNextAudio();
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, [playNextAudio]);

  return (
    <div>
      <h1>
        <Volume2 size={24} /> TTS Audio Test
      </h1>
      <p>{message}</p>
      <input value={ssbrId} onChange={(e) => setSsbrId(e.target.value)} placeholder="SSBR ID" />
      <button type="button" onClick={generateAudio}>
        Generate test audio
      </button>
      <button type="button" onClick={playNextAudio}>
        <Volume2 size={16} /> Play next announcement
      </button>
      <p>URL: {lastUrl || '-'}</p>
      <audio
        ref={audioRef}
        controls
        onEnded={async () => {
          await markCurrentAudioPlayed();
          setMessage('Audio selesai');
        }}
      />
    </div>
  );
};

export default TtsAudioTestPage;
