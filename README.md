# AI MikroTik Assistant (MVP)

Implementasi MVP dari PRD `AI_MikroTik_Assistant_PRD_v0.2` — aplikasi web berbasis LLM untuk menganalisa, mengaudit, troubleshoot, dan menghasilkan konfigurasi MikroTik. **Sistem read-only terhadap router; AI tidak pernah mengeksekusi perubahan.**

## Fitur (P0)

- Tambah/edit/hapus MikroTik, multi-router, koneksi terisolasi per router (FR-001, FR-004, FR-005)
- Test connection + sinkronisasi via **RouterOS API** (FR-002, FR-006)
- Kompatibilitas RouterOS 5+ dengan collector per-resource: `success` / `failed` / `unsupported` (FR-003)
- Router context tersimpan (snapshot + metadata koleksi + kesegaran/stale) (FR-007, FR-008)
- Chat natural-language berbasis konteks router terpilih (FR-009, FR-010)
- Batch aturan anti-halusinasi: AI harus menyatakan data yang tak tersedia (FR-011, AC-005)
- Generate script/command RouterOS sebagai **teks untuk review manual**, tanpa eksekusi otomatis (FR-012, FR-014, FR-015, AC-004)
- Penjelasan efek, dependensi, konflik, risiko (FR-016)
- Audit konfigurasi per router (FR-017) — kini 3 jenis: **Audit Konfigurasi**, **Audit Keamanan**, **Audit Keamanan Jaringan**; proses ditampilkan bertahap (live streaming), hasil diunduh sebagai **PDF profesional** (jsPDF: cover, identitas perusahaan/router, tabel temuan+severity, tabel markdown, paginasi)
- Troubleshooting berbasis bukti: `confirmed` / `probable` / `insufficient` (FR-018, FR-019)
- AI provider **OpenAI-compatible**: Base URL, Model, API Key (FR/US-006, AC-007)
- Kredensial router & API key dienkripsi (AES-256-GCM); log memakai redaksi otomatis
- UI: field **nama perusahaan** per router (ikutserta di konteks audit/chat & PDF), riwayat audit **paginasi + hapus**, riwayat chat **hapus**, Activity Log **paginasi (25/50/100) + filter + hapus router**

Arsitektur mengikuti prinsip PRD: Web/API Layer, RouterOS Connector (read-only boundary), Data Collector, Context Store, Analysis Orchestrator, LLM Adapter, Output Guard.

## Persyaratan

- Node.js **>= 22.13** (memakai modul built-in `node:sqlite`)

## Menjalankan

**Tanpa CMD:** klik dua kali **`start.bat`** (auto-install dependensi + buka browser).

Manual:

```bash
npm install
npm start          # atau: npm run dev (auto-restart)
```

Buka `http://localhost:3000`.

**Login pertama:** user `admin`, password `admin` — segera ganti lewat menu *Settings*.

## Alur pakai

1. *AI Provider* → isi Base URL (`https://api.openai.com/v1`, `http://localhost:11434/v1` untuk Ollama, `http://localhost:1234/v1` untuk LM Studio), Model, API Key.
2. *Routers* → Tambah Router (host, port API 8728/8729-SSL, user, password) → **Test Connection**.
3. **Sync Data** → mengumpulkan ~37 resource (identity, interfaces, firewall, NAT, routing, DHCP, DNS, queue, PPP, dll).
4. Buka router → tab *Chat* untuk analisa/troubleshoot, tab *Audit* untuk laporan audit.

## API

| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/auth/login` | login admin (cookie session) |
| GET/POST | `/api/routers` | list / tambah router (termasuk `company`) |
| PUT/DELETE | `/api/routers/:id` | edit / hapus (cascade chat+audit+context) |
| POST | `/api/routers/:id/test` | test koneksi RouterOS API |
| POST | `/api/routers/:id/sync` | kumpulkan data router |
| POST | `/api/routers/:id/chat` | chat SSE (streaming) |
| POST | `/api/routers/:id/audit` | audit SSE — body `{kind: "audit-config"\|"audit-security"\|"audit-network"}` |
| GET | `/api/routers/:id/audits?limit=&offset=` | riwayat audit (paginasi) |
| GET/DELETE | `/api/audits/:id` | detail hasil (utk PDF) · hapus hasil |
| GET/DELETE | `/api/chats/:id` | pesan chat · hapus histori |
| GET/PUT | `/api/provider` | konfigurasi AI provider |
| GET | `/api/logs?limit=&offset=` | activity log (paginasi, redaksi otomatis) |

## Keamanan

- `MT_APP_SECRET` (env) dipakai untuk menurunkan kunci enkripsi kredensial. Jika tidak diset, kunci acak disimpan di `data/.secret`.
- `data/` berisi DB + secret, jangan dikomit (sudah di `.gitignore`).
- Password/API key/credential tidak pernah ditulis ke log maupun dikirim ke / dimasukkan ke prompt LLM.
- Boundary read-only ditegakkan lapis ganda: guard command pada konektor (blokir `add/set/remove/reboot/...`) dan Output Guard di sisi respons (banner peringatan + footer konsultatif).

## Test

```bash
npm test
```

## Env

| Vars | Default | Keterangan |
|---|---|---|
| `PORT` | 3000 | port web |
| `HOST` | 0.0.0.0 | bind address |
| `MT_APP_SECRET` | — | kunci enkripsi (opsional) |
| `STALE_AFTER_HOURS` | 24 | ambang data stale |