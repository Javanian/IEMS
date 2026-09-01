from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import logging
import psycopg2
from psycopg2 import pool
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ROOT_DIR = next(
    (path for path in [BASE_DIR, *BASE_DIR.parents] if (path / ".env").exists()),
    BASE_DIR.parents[1] if len(BASE_DIR.parents) > 1 else BASE_DIR,
)
ROOT_DIR = Path(os.getenv("PROJECT_ROOT", DEFAULT_ROOT_DIR))
API_DIR = Path(os.getenv("API_DIR", ROOT_DIR / "apps" / "api"))

if (ROOT_DIR / ".env").exists() or (BASE_DIR / ".env").exists():
    from dotenv import load_dotenv

    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(BASE_DIR / ".env", override=True)


DB_CONFIG = {
    "host": os.getenv("DB_HOST", "db"),
    "dbname": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "port": int(os.getenv("DB_PORT", 5432)),
    "connect_timeout": 5,
}

PORT = int(os.getenv("PORTFLASK", "8000"))
TTS_UPLOAD_ROOT = Path(os.getenv("TTS_UPLOAD_ROOT", API_DIR / "uploads"))
TTS_ANNOUNCEMENT_DIR = TTS_UPLOAD_ROOT / "announcement"
TTS_ANNOUNCEMENT_PUBLIC_PREFIX = "/uploads/announcement"
TTS_LEGACY_ANNOUNCEMENT_DIR = BASE_DIR / "upload" / "announcement"
TTS_LEGACY_ANNOUNCEMENT_PUBLIC_PREFIX = "/upload/announcement"

log = logging.getLogger("fastapi")


db_pool = pool.SimpleConnectionPool(1, 10, **DB_CONFIG)


def get_conn():
    return db_pool.getconn()


def release_conn(conn):
    db_pool.putconn(conn)


app = FastAPI(title="MS Project Sync API")


@app.get("/health")
def health():
    return {"status": "ok"}


class SowPlanUpdate(BaseModel):
    order_no: str
    operation_no: str
    plan_start: str
    plan_finish: str
    workcenter: Optional[str] = None
    note: Optional[str] = None


class KeyRequest(BaseModel):
    keys: List[str]


class MissingRequest(BaseModel):
    order_no: str
    codenumber: List[str]


class TtsGenerateRequest(BaseModel):
    ssbr_id: str


MAX_TTS_SSBR_ID_LENGTH = 64


def validate_tts_ssbr_id(ssbr_id: str) -> str:
    cleaned = str(ssbr_id or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="ssbr_id wajib diisi")
    if len(cleaned) > MAX_TTS_SSBR_ID_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"ssbr_id maksimal {MAX_TTS_SSBR_ID_LENGTH} karakter"
        )
    return cleaned


def ensure_tts_notification_order_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS public.tts_notification_order (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                path_mp3 TEXT NULL,
                ssbr_id TEXT,
                status BOOLEAN NOT NULL DEFAULT false,
                generation_status TEXT NOT NULL DEFAULT 'queued',
                error_message TEXT,
                attempts INT NOT NULL DEFAULT 0,
                log_audio JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                generated_at TIMESTAMPTZ
            )
        """)
        cur.execute("ALTER TABLE public.tts_notification_order ALTER COLUMN path_mp3 DROP NOT NULL")
        cur.execute(
            "ALTER TABLE public.tts_notification_order ADD COLUMN IF NOT EXISTS ssbr_id TEXT"
        )
        cur.execute(
            "ALTER TABLE public.tts_notification_order "
            "ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'queued'"
        )
        cur.execute(
            "ALTER TABLE public.tts_notification_order ADD COLUMN IF NOT EXISTS error_message TEXT"
        )
        cur.execute(
            "ALTER TABLE public.tts_notification_order ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0"
        )
        cur.execute(
            "ALTER TABLE public.tts_notification_order ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ"
        )
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_tts_notification_order_status_created
            ON public.tts_notification_order (status, created_at)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_tts_notification_order_generation_status_created
            ON public.tts_notification_order (generation_status, created_at)
        """)
        cur.execute("""
            UPDATE public.tts_notification_order
            SET generation_status = 'ready'
            WHERE path_mp3 IS NOT NULL
              AND generation_status = 'queued'
        """)
    conn.commit()


def announcement_file_from_path(path_mp3: str) -> Path:
    if not path_mp3:
        raise HTTPException(status_code=404, detail="Path audio kosong")

    path_options = (
        (f"{TTS_ANNOUNCEMENT_PUBLIC_PREFIX}/", TTS_ANNOUNCEMENT_DIR),
        (f"{TTS_LEGACY_ANNOUNCEMENT_PUBLIC_PREFIX}/", TTS_LEGACY_ANNOUNCEMENT_DIR),
    )
    for prefix, base_dir in path_options:
        if not path_mp3.startswith(prefix):
            continue

        filename = Path(path_mp3.removeprefix(prefix)).name
        file_path = base_dir / filename
        try:
            file_path.resolve().relative_to(base_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="Path audio tidak valid")

        return file_path

    raise HTTPException(status_code=400, detail="Path audio tidak valid")


@app.post("/tts/generate")
def generate_tts_announcement(data: TtsGenerateRequest):
    ssbr_id = validate_tts_ssbr_id(data.ssbr_id)

    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO public.tts_notification_order (
                ssbr_id,
                path_mp3,
                status,
                generation_status,
                error_message,
                attempts,
                log_audio
            )
            VALUES (%s, NULL, false, 'queued', NULL, 0, NULL)
            RETURNING id, ssbr_id, path_mp3, status, generation_status, attempts, created_at
            """,
            (ssbr_id,),
        )
        row = cur.fetchone()
        conn.commit()

        return {
            "id": row[0],
            "ssbr_id": row[1],
            "path_mp3": row[2],
            "status": row[3],
            "generation_status": row[4],
            "attempts": row[5],
            "created_at": str(row[6]) if row[6] else None,
            "audio_url": None,
        }
    except Exception as exc:
        conn.rollback()
        log.exception("Failed to enqueue TTS announcement")
        raise HTTPException(status_code=500, detail=f"Gagal enqueue notif audio: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


@app.get("/tts/audio/next")
def get_next_tts_audio():
    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute("""
            SELECT id, path_mp3
            FROM public.tts_notification_order
            WHERE generation_status = 'ready'
              AND status = false
              AND path_mp3 IS NOT NULL
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """)
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Tidak ada audio announcement yang pending")

        notification_id, path_mp3 = row
        file_path = announcement_file_from_path(path_mp3)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File audio tidak ditemukan")

        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET status = true,
                updated_at = now()
            WHERE id = %s
            RETURNING id
            """,
            (notification_id,),
        )
        conn.commit()

        return FileResponse(
            path=file_path,
            media_type="audio/mpeg",
            filename=file_path.name,
            headers={"X-TTS-Notification-Id": str(notification_id)},
        )
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Gagal ambil audio: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


@app.get("/tts/audio/pending")
def get_pending_tts_audio():
    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute("""
            SELECT id, path_mp3, ssbr_id, created_at, generated_at
            FROM public.tts_notification_order
            WHERE generation_status = 'ready'
              AND status = false
              AND path_mp3 IS NOT NULL
            ORDER BY created_at ASC, id ASC
            LIMIT 20
            """)
        rows = cur.fetchall()
        if not rows:
            return {"data": None}

        for row in rows:
            notification_id, path_mp3, ssbr_id, created_at, generated_at = row
            try:
                file_path = announcement_file_from_path(path_mp3)
                if file_path.exists():
                    return {
                        "data": {
                            "id": notification_id,
                            "path_mp3": path_mp3,
                            "ssbr_id": ssbr_id,
                            "created_at": str(created_at) if created_at else None,
                            "generated_at": str(generated_at) if generated_at else None,
                            "audio_url": f"/tts/audio/{notification_id}/stream",
                        }
                    }
                error_message = f"File audio tidak ditemukan: {path_mp3}"
            except HTTPException as exc:
                error_message = str(exc.detail)

            cur.execute(
                """
                UPDATE public.tts_notification_order
                SET generation_status = 'error',
                    error_message = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (error_message, notification_id),
            )

        conn.commit()
        return {"data": None}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gagal cek audio pending: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


@app.get("/tts/audio/{notification_id}/stream")
def stream_tts_audio(notification_id: int):
    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, path_mp3
            FROM public.tts_notification_order
            WHERE id = %s
              AND generation_status = 'ready'
              AND status = false
              AND path_mp3 IS NOT NULL
            """,
            (notification_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notif audio pending tidak ditemukan")

        file_path = announcement_file_from_path(row[1])
        if not file_path.exists():
            cur.execute(
                """
                UPDATE public.tts_notification_order
                SET generation_status = 'error',
                    error_message = %s,
                    updated_at = now()
                WHERE id = %s
                """,
                (f"File audio tidak ditemukan: {row[1]}", notification_id),
            )
            conn.commit()
            raise HTTPException(status_code=404, detail="File audio tidak ditemukan")

        return FileResponse(
            path=file_path,
            media_type="audio/mpeg",
            filename=file_path.name,
            headers={"X-TTS-Notification-Id": str(notification_id)},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Gagal stream audio: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


@app.post("/tts/audio/{notification_id}/played")
def mark_tts_audio_played(notification_id: int):
    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET status = true,
                updated_at = now()
            WHERE id = %s
              AND generation_status = 'ready'
            RETURNING id
            """,
            (notification_id,),
        )
        row = cur.fetchone()
        conn.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Notif audio tidak ditemukan")

        return {"ok": True, "id": row[0]}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Gagal update status audio: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


@app.get("/tts/audio/{notification_id}")
def get_tts_audio(notification_id: int):
    conn = get_conn()
    cur = None
    try:
        ensure_tts_notification_order_table(conn)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, path_mp3
            FROM public.tts_notification_order
            WHERE id = %s
              AND generation_status = 'ready'
              AND path_mp3 IS NOT NULL
            FOR UPDATE
            """,
            (notification_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notif audio tidak ditemukan")

        file_path = announcement_file_from_path(row[1])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File audio tidak ditemukan")

        cur.execute(
            """
            UPDATE public.tts_notification_order
            SET status = true,
                updated_at = now()
            WHERE id = %s
            """,
            (notification_id,),
        )
        conn.commit()

        return FileResponse(
            path=file_path,
            media_type="audio/mpeg",
            filename=file_path.name,
            headers={"X-TTS-Notification-Id": str(notification_id)},
        )
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Gagal ambil audio: {exc}") from exc
    finally:
        if cur:
            cur.close()
        release_conn(conn)


@app.post("/sow/update-plan")
def update_sow_plan(data: SowPlanUpdate):

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute(
            """
            UPDATE sow
            SET plan_start = %s,
                plan_finish = %s,
                workcenter = %s
            WHERE order_no = %s
              AND operation_no = %s
        """,
            (data.plan_start, data.plan_finish, data.workcenter, data.order_no, data.operation_no),
        )

        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Data tidak ditemukan")

        conn.commit()

        return {"status": "success", "updated": cur.rowcount}

    finally:
        cur.close()
        release_conn(conn)


@app.post("/sow/get-actual")
def get_actual(data: KeyRequest):

    if not data.keys:
        return {"count": 0, "data": []}

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute(
            """
            SELECT codenumber,
                   actual_progress,
                   actual_hours,
                   actual_start,
                   actual_finish
            FROM sow
            WHERE codenumber = ANY(%s::text[])
        """,
            (data.keys,),
        )

        rows = cur.fetchall()

        results = [
            {
                "codenumber": r[0],
                "actual_progress": float(r[1] or 0),
                "actual_hours": float(r[2] or 0),
                "actual_start": str(r[3]) if r[3] else None,
                "actual_finish": str(r[4]) if r[4] else None,
            }
            for r in rows
        ]

        return {"count": len(results), "data": results}

    finally:
        cur.close()
        release_conn(conn)


@app.post("/sow/get-missing")
def get_missing(data: MissingRequest):

    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute(
            """
            SELECT order_no,
                   operation_no,
                   workcenter,
                   planhours,
                   operation_text
            FROM sow
            WHERE order_no = %s
              AND (order_no || operation_no) != ALL(%s)
            ORDER BY operation_no
        """,
            (data.order_no, data.codenumber),
        )

        rows = cur.fetchall()

        results = [
            {
                "order_no": r[0],
                "operation_no": r[1],
                "workcenter": r[2],
                "planhours": float(r[3] or 0),
                "operation_text": r[4],
            }
            for r in rows
        ]

        return {
            "order_no": data.order_no,
            "requested_count": len(data.codenumber),
            "missing_count": len(results),
            "data": results,
        }

    finally:
        cur.close()
        release_conn(conn)


class SowPlanUpdateBulk(BaseModel):
    items: List[SowPlanUpdate]


@app.post("/sow/update-plan-bulk")
def update_sow_plan_bulk(data: SowPlanUpdateBulk):

    conn = get_conn()
    cur = conn.cursor()

    try:
        values = [
            (item.plan_start, item.plan_finish, item.workcenter, item.order_no, item.operation_no)
            for item in data.items
        ]

        cur.executemany(
            """
            UPDATE sow
            SET plan_start = %s,
                plan_finish = %s,
                workcenter = %s
            WHERE order_no = %s
              AND operation_no = %s
        """,
            values,
        )

        conn.commit()

        return {"status": "success", "updated": len(values)}

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        release_conn(conn)


class GetNewRequest(BaseModel):
    order_no: Optional[str] = None


@app.post("/sow/get-new")
def get_new_operations(data: GetNewRequest):
    conn = get_conn()
    cur = conn.cursor()

    try:
        query = """
            SELECT order_no,
                   operation_no,
                   workcenter,
                   planhours,
                   operation_text,
                   plan_start,
                   plan_finish,
                   ssbr_id,
                   part_name
            FROM sow
            WHERE sync = 'modified'
        """
        params = []
        if data.order_no:
            query += " AND order_no = %s"
            params.append(data.order_no)

        query += " ORDER BY order_no, operation_no"

        cur.execute(query, params if params else None)
        rows = cur.fetchall()

        results = [
            {
                "order_no": r[0],
                "operation_no": r[1],
                "workcenter": r[2],
                "planhours": float(r[3] or 0),
                "operation_text": r[4],
                "plan_start": str(r[5]) if r[5] else None,
                "plan_finish": str(r[6]) if r[6] else None,
                "ssbr_id": r[7],
                "part_name": r[8],
            }
            for r in rows
        ]

        return {"count": len(results), "data": results}

    finally:
        cur.close()
        release_conn(conn)


class SyncUpdateRequest(BaseModel):
    order_nos: List[str]
    sync_status: str = "scheduled"


@app.post("/sow/update-sync")
def update_sync_status(data: SyncUpdateRequest):
    conn = get_conn()
    cur = conn.cursor()

    try:
        cur.execute(
            """
            UPDATE sow
            SET sync = %s
            WHERE order_no = ANY(%s::text[])
        """,
            (data.sync_status, data.order_nos),
        )

        conn.commit()
        return {"status": "success", "updated": cur.rowcount}

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        cur.close()
        release_conn(conn)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
