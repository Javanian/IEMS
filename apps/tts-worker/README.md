# TTS worker

Refreshes the order-hours materialized view and generates shop-floor voice announcements with [Piper](https://github.com/rhasspy/piper), offline.

The announcements are spoken in Indonesian because the operators who hear them speak Indonesian. `speech_normalize.py` turns numbers, order codes and times into words the Indonesian voice reads correctly.

## Quick start

```bash
psql -U postgres -d iems -f apps/tts-worker/migrate_tts.sql
cd apps/tts-worker
python refresh_and_notify.py
```

Example cron entry:

```bash
*/30 * * * * cd /path/to/IEMS/apps/tts-worker && python refresh_and_notify.py >> logs/tts.log 2>&1
```

## Voice model

```bash
cd apps/tts-worker/models

wget -O "id_ID.onnx" \
https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx

wget -O "id_ID.onnx.json" \
https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json
```

`PIPER_MODEL_PATH` and `PIPER_CONFIG_PATH` point at a different voice if you need one.

## Announcement queue

The FastAPI endpoint `/tts/generate` only adds a row to `tts_notification_order`. The worker produces the audio:

```bash
docker compose build tts-worker
docker compose up -d tts-worker
docker compose logs -f tts-worker
```

Finished MP3 files land in `apps/api/uploads/announcement` during local development, or in the `/uploads/announcement` mount under Docker.
