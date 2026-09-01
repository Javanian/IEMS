#!/usr/bin/env node
/**
 * database/migrate.js — minimal migration runner (REFACTOR_PLAN D-R1).
 *
 * Menerapkan file .sql di database/migrations/api/ yang BELUM tercatat di
 * public.schema_migrations, urut nama file, masing-masing dalam satu transaksi.
 *
 * Pakai:
 *   node database/migrate.js --dry-run   # tampilkan pending, tanpa apply
 *   node database/migrate.js             # apply semua pending
 *
 * Konvensi file migration (D-R5):
 *   - Nama: YYYYMMDD_deskripsi.sql (urutan = urutan nama).
 *   - JANGAN tulis BEGIN/COMMIT sendiri — runner yang membungkus.
 *   - Idempotent bila mungkin (IF NOT EXISTS / ON CONFLICT).
 *   - Butuh CREATE INDEX CONCURRENTLY (tak bisa dalam transaksi)? Tulis
 *     `-- migrate:no-transaction` di baris pertama file.
 *   - Setelah batch migrasi: regenerate database/schema/schema_prod.sql dari prod.
 *
 * Koneksi: baca .env di root repo (DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD).
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(__dirname, "migrations", "api");

// Parser .env kecil tanpa dependency (setdefault — env eksplisit menang).
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const client = new Client({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME || "ptssb",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      note       text
    )`);

  const applied = new Set(
    (await client.query("SELECT filename FROM public.schema_migrations")).rows.map((r) => r.filename)
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((f) => !applied.has(f));

  console.log(`ledger: ${applied.size} tercatat | folder: ${files.length} file | pending: ${pending.length}`);
  if (!pending.length) { await client.end(); return; }
  pending.forEach((f) => console.log("  pending:", f));
  if (dryRun) { console.log("(dry-run — tidak ada yang diterapkan)"); await client.end(); return; }

  for (const f of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    const noTx = /^--\s*migrate:no-transaction/.test(sql);
    process.stdout.write(`apply ${f}${noTx ? " [no-tx]" : ""} ... `);
    try {
      if (noTx) {
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations(filename) VALUES ($1)", [f]);
      } else {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations(filename) VALUES ($1)", [f]);
        await client.query("COMMIT");
      }
      console.log("OK");
    } catch (err) {
      if (!noTx) await client.query("ROLLBACK").catch(() => {});
      console.error(`GAGAL: ${err.message}`);
      console.error("Berhenti. Perbaiki file migration lalu jalankan ulang — yang sudah OK tidak diulang.");
      process.exitCode = 1;
      break;
    }
  }
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
