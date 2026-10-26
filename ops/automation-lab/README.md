# IEMS Customer Service Automation Center via n8n

Dokumentasi implementasi, arsitektur, dan panduan pengoperasian automasi Customer Service IEMS menggunakan n8n, Scoped API `portfolio-api`, dan Local SMTP Sink.

---

## 1. Arsitektur & Prinsip Keamanan

1. **Boundary & Source of Truth**:
   - Database domain IEMS (MongoDB/PostgreSQL) **tidak pernah diakses langsung** oleh n8n.
   - Semua interaksi n8n dilakukan melalui Scoped Authoritative API di `portfolio-api` (`/api/cs/automation/*`).
   - Setiap mutasi wajib membawa header `Idempotency-Key` (8..100 karakter). Pemanggilan ulang dengan kunci yang sama mengembalikan hasil identik tanpa mutasi ganda (*no double-escalation*).

2. **Anti-Stale Re-check**:
   - Sebelum melakukan eskalasi atau mutasi berdampak, workflow selalu memanggil `POST /api/cs/automation/recheck`.
   - Jika tiket telah diselesaikan (`RESOLVED`/`CLOSED`) atau versinya berubah karena aksi operator concurrent, sistem secara elegan menolak eksekusi tanpa efek samping.

3. **Zero-Internet Local SMTP Sink**:
   - Menggunakan sink SMTP lokal RFC-5321 murni di port `1025` dan HTTP API port `1080` (`ops/automation-lab/smtp-sink.mjs`).
   - Semua email menggunakan alamat sintetis/local test (`reports@iems.local`, `cs-leads@iems.local`).
   - Status penerimaan dicatat sebagai `Accepted by local mail sink`.

4. **WhatsApp Preview Guarantee**:
   - Status delivery WhatsApp pada simulator channel dicatat secara eksplisit sebagai `PREVIEWED`, bukan fake `SENT`.

---

## 2. Tiga Workflow n8n

File definisi workflow tersedia di `ops/automation-lab/workflows/`:
1. `wf-sla-escalation.json` (**Ticket SLA Monitor & Re-check Escalation**):
   - Memicu pemindaian tiket breached (`/api/cs/automation/sla-breaches?thresholdMinutes=15`).
   - Mengeksekusi anti-stale re-check (`/api/cs/automation/recheck`).
   - Mengirim notifikasi email ke local SMTP sink (`127.0.0.1:1025`).
   - Mengeskalasi stage tiket (`NEW -> TRIAGED -> ASSIGNED -> IN_PROGRESS`), mencatat `cs_internal_notes`, dan audit log.
2. `wf-whatsapp-handoff.json` (**WhatsApp Approval & Hand-off Sync**):
   - Menerima webhook event handoff.
   - Mengalihkan mode percakapan ke `HUMAN_TAKEN_OVER` dan mencatat status `PREVIEWED`.
3. `wf-cs-weekly-digest.json` (**Weekly CS Operations Digest**):
   - Mengambil ringkasan operasional 7 hari terakhir (`/api/cs/automation/digest?days=7`).
   - Mengirim email digest berformat Markdown & HTML ke sink lokal.
   - Mencatat tanda terima digest di domain.

---

## 3. Menjalankan Komponen

### A. Local SMTP Sink
```bash
node ops/automation-lab/smtp-sink.mjs
# Berjalan pada smtp://127.0.0.1:1025 dan http://127.0.0.1:1080
```
- Endpoint HTTP sink:
  - `GET /health` -> Status sink & jumlah email tertangkap.
  - `GET /api/emails` -> Daftar email tertangkap.
  - `DELETE /api/emails` -> Membersihkan penampung email.

### B. n8n Standalone (Loopback)
```bash
cd D:/IEMS-Automation-Lab
set N8N_USER_FOLDER=D:/IEMS-Automation-Lab/n8n-data
set N8N_PORT=5678
set N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
npx n8n start
```
Akses UI di: `http://127.0.0.1:5678` (Loopback only).

### C. Menjalankan Pengujian API & E2E Workflows
```bash
# Unit test Scoped API Automation
node --test apps/portfolio-api/test/automation.test.mjs

# End-to-end integration test (Sink + Workflows + API + Anti-stale Guard)
node --test apps/portfolio-api/test/automation-e2e.test.mjs
```

---

## 4. Antarmuka Web (IEMS Web UI)

- Route: `/portfolio/service/automation` (tab baru "Automation Center" di modul Customer Service).
- Komponen: `apps/web/src/features/portfolio/AutomationCenterWorkspace.jsx`.
- Menyajikan status engine, monitor live SLA breaches, generator & viewer weekly digest, tabel pesan yang tertangkap di SMTP sink, serta audit trail rekonsiliasi.
