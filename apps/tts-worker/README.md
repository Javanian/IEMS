# TTS Worker

Worker ini refresh materialized view order hours dan generate audio announcement memakai Piper.

## Quick Start

```bash
psql -U postgres -d ptssb -f apps/tts-worker/migrate_tts.sql
cd apps/tts-worker
python refresh_and_notify.py
```

Cron contoh:

```bash
*/30 * * * * cd /path/to/MPS2/apps/tts-worker && python refresh_and_notify.py >> logs/tts.log 2>&1
```

## Model Files

```bash
cd ~/MPS2/apps/tts-worker/models

wget -O "id_ID.onnx" \
https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx

wget -O "id_ID.onnx.json" \
https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json
```

## Queue Worker Audio Announcement

FastAPI `/tts/generate` hanya membuat queue di `tts_notification_order`. Audio dibuat oleh worker:

```bash
docker compose build tts-worker
docker compose up -d tts-worker
docker compose logs -f tts-worker
```

MP3 final tersimpan di `apps/api/uploads/announcement` saat local development, atau Docker mount `/uploads/announcement`.
