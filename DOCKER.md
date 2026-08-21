# Docker — AI MikroTik Assistant

Jalankan di Ubuntu Server pakai Docker Compose.

## Persiapan

```bash
# 1. Pasang Docker (jika belum)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER    # agar tidak perlu sudo tiap perintah
newgrp docker

# 2. Pasang docker compose plugin (biasanya termasuk di installer resmi di atas)
sudo apt-get update && sudo apt-get install -y docker-compose-plugin
```

Keluar login, lalu kembali.

## Build & jalankan

```bash
cd /path/ke/Versi\ 2   # folder aplikasi di Ubuntu Server

docker compose up -d --build
```

Akses: `http://<IP_UBUNTU_SERVER>:3000`

Lihat log:
```bash
docker compose logs -f
```

Hentikan / hapus:
```bash
docker compose down            # hapus container (volume data/logs TETAP ada)
docker compose down -v         # hapus juga volume → data/login hilang
```

## Data & volume

| Volume | Isi | Catatan |
|---|---|---|
| `data` | `data/mikrotik-assistant.db` (SQLite WAL) + `data/.secret` (AES-256 key) | **JANGAN hapus** bila ada router/API key tersimpan — kuncinya tersimpan di `.secret`, jika hilang kredensial yang sudah dienkripsi tidak bisa dibaca kembali. Backup secara periodik. |
| `logs` | `logs/app.log` (JSON, sudah redact) | Rotasi manual bila perlu. |

Nama volume mengikuti nama folder proyek (default: `<folder>_data`, `<folder>_logs`). Cek dengan:
```bash
docker volume ls
```

Backup DB dari host:
```bash
docker run --rm -v versi2_data:/data -v "$PWD":/backup alpine \
  cp /data/mikrotik-assistant.db /backup/mikrotik-assistant.db.bak
```
(ganti `versi2_data` sesuai output `docker volume ls`)

## Keamanan / konfigurasi via environment

Dokumentasi env tersedia di README. Nilai penting:

- `PORT` (default 3000), `HOST` (default 0.0.0.0) — sudah diset di compose.
- `MT_APP_SECRET` — **disarankan** bila kamu ingin meregenerasi container tanpa mengandalkan `.secret` di volume. Jika diset, kunci enkripsi stabil walaupun volume `data` diganti. Jangan hardcode di repo; inject via shell di server:
  ```bash
  MT_APP_SECRET="$(openssl rand -hex 32)" docker compose up -d --build
  ```
- `STALE_AFTER_HOURS` (default 24).

## Login pertama

`admin` / `admin` — di-seed otomatis pada boot pertama kali (DB kosong). Ganti segera melalui *Settings*.

## Catatan platform

- Image memakai `node:22-alpine`. Cocok karena dependensi satu-satunya (`express`) pure JS dan `node:sqlite` built-in (tidak perlu native build).
- Discovery jaringan (MNDP/UDP 5678) berjalan di dalam container; radiusnya terbatas subnet broadcast tempat container berada — bukan blokir penggunaan manual menambah/tetsing router.
- Container berjalan sebagai user non-root (uid 1000) demi keamanan. Port 3000 > 1024 sehingga tidak butuh `CAP_NET_BIND_SERVICE`.
