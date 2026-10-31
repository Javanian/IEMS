# TPR-155: rekonsiliasi kontrak stock dan repair

Status implementasi lokal, bukan acceptance produk. Integrasi oleh CTO TPR-151; review independen TPR-152 pada kandidat hasil integrasi. Bukti asli TPR-150 tidak diubah.

Base: candidate `96b8bea912a52b6c9ead1f03e698666edf64df0e`, kemudian predecessor TPR-154 `6808232182c574f201e37bcb050049ec61368377`, keduanya fast-forward dari branch manufacturing yang ditugaskan. Tidak ada perubahan product source, schema, UI, admission atau registry.

| Keluarga | Ekspektasi lama dan penyebab kegagalan | Kontrak pengganti dan proteksi yang dipertahankan |
| --- | --- | --- |
| QA-003 trace/use | Semua output V2 dianggap LEAF_ONLY, padahal putaway yang disetujui menerbitkan MULTI_GENERATION_SOURCE. | Output baru reusable, trace V2 menyatakan multiGeneration dan menyimpan exact parent/raw/loss ancestry. Snapshot GET tetap identik. Kasus historical terminal dipisahkan sebagai fixture synthetic LEAF_ONLY dengan receipt/head/event yang konsisten; reserve tetap ditolak, marker dihapus tetap invalid, fixture dipulihkan sesudah tes. Tidak ada migrasi atau resealing data historis. |
| QA-005 repair | Execute REPLACE tanpa removal/installation mendapat REPLACEMENT_REQUIRED sebelum validator audit yang sengaja dibuat gagal. | REPLACE tetap wajib. Tes menolak missing installation tanpa efek, lalu menjalankan approved spare authorization, customer removal, exact-unit reserve, issue dan install melalui HTTP. Setelah itu fault injection benar-benar mencapai audit/outbox. Snapshot rollback diperluas ke repair authority events, ledger stok, dan frozen genealogy. Rework/latest-pass/hold/QC/return, exact money, replay, denied access dan transactional reauthorization tetap diperiksa. |
| QA-005 warehouse | Snapshot PO dianggap tidak berubah sama sekali setelah receive. | Seluruh field PO tetap persis sama kecuali receiptFence bertambah tepat satu per receipt yang committed. Dua loser concurrent tidak menambah fence. Receipt sisa menambah tepat satu; excess tidak mengubah PO. Exact quantity/UOM dan stock rollback tetap diuji. |
| QA-005 hold/QC | Fixture mengubah snapshot quantity tanpa approved revision, sehingga immutable source menolak receipt tambahan. | PR3 disetujui, dikonversi dan PO diterbitkan melalui HTTP; receipts2+1 menghabiskan tepat approved quantity. Excess ditolak tanpa receipt baru. QC release tidak menghapus hold; hold release tidak memberi QC approval; role denial dan encumbered reserve tetap wajib. |

Pembuktian tambahan menggunakan tes existing: manufactured graph cycle/unique-parent/conservation/bounds, native three-generation flow/frozen ancestry, canonical replacement/rework, quality/calibration/qualification. Tidak ada case di-skip, guard diabaikan, expected status500 diganti409, atau runtime adapter dipalsukan.

QA-001 tetap milik final platform: `company-stock-readiness.test.mjs`, subtest `claim101 is refused atomically while exact acknowledged replay still reauthorizes`. Snapshot replay memiliki tambahan `tenants.saasEnrollmentFence` yang tidak tercakup expected authorization fences. Ekspektasi itu tidak diubah di TPR-155. Keluarga document PREPARED, CS, commercial dan browser lintas domain berada di luar assignment ini.

Hasil pada source final `ed6a40a26dfdbd44b23cf7db7b40b55747c3555d`: focused maintained **48/48 PASS**, tambahan domain **7/7 PASS**, tanpa skip/cancellation. Baseline sebelum edit: **29 PASS / 7 FAIL** dari36 reported tests, termasuk parent failures. Syntax API dan contracts typecheck PASS; typecheck awal missing dependency disimpan sebelum locked install. Reproduksi native QA-001 yang hanya menjalankan satu acknowledged replay tetap **FAIL** dengan response persis sama, expected enrollment fence99 dan actual102, hanya collection tenants berbeda. Ini mereproduksi seam replay yang sama; batas100claims/501events tidak dijalankan ulang dan maintained readiness test tidak diubah.

Commit per keluarga: QA-003 `76e367890db5d3aac3768535a86570471426b0b4`; repair `19b36c990881a53038012fc75452eaa92c6d914f`; warehouse `908131746dc9677a47d7d19eab0d1ade9fd400ff`; hold/QC `ed6a40a26dfdbd44b23cf7db7b40b55747c3555d`. Tidak ada product-source delta yang memerlukan perubahan admission source pins. Log Mongo ECONNRESET tetap disimpan; seluruh assertion suite terkait lulus dan pemeriksaan akhir proses/cleanup dicatat di checkpoint. Tidak ada klaim bahwa campaign reliability atau full regression telah lulus.

Perintah focused dari root workspace:

```text
node --test --test-concurrency=1 --test-reporter=tap apps/portfolio-api/test/company-stock-trace.test.mjs apps/portfolio-api/test/company-stock-use.test.mjs apps/portfolio-api/test/repair.test.mjs apps/portfolio-api/test/warehouse.test.mjs apps/portfolio-api/test/wave4f-stock-holds.test.mjs
node --test --test-concurrency=1 --test-reporter=tap packages/contracts/src/domains/planning-execution/manufactured-graph.test.mjs packages/contracts/src/domains/planning-execution/multigeneration-flow.test.mjs packages/contracts/src/domains/engineering-repair/spare-flow.test.mjs packages/contracts/src/domains/engineering-repair/quality-flow.test.mjs
```

Gunakan cached Mongo7.0.14 dengan `MONGOMS_RUNTIME_DOWNLOAD=false`. Semua runtime memiliki randomized namespace, marker, loopback HTTP dan cleanup terdaftar. Evidence final, perintah lengkap, exit/counts/tested SHA serta limitation berada di checkpoint eksternal `D:/Project AI/GITHUB/IEMS-evidence/agent-checkpoints/TPR-155/3f28ceb5-2fcb-4ee8-b4a4-ebd6bdb5716a/LATEST.md`. Model aktual UNVERIFIED. Full regression/browser/security acceptance belum dibuktikan oleh handoff implementasi ini.
