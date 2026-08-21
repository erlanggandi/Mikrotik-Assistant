@echo off
setlocal
cd /d "%~dp0"
title AI MikroTik Assistant

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js tidak ditemukan. Install Node.js versi 22+ dari https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Menginstall dependensi untuk pertama kali...
  call npm install
  if errorlevel 1 (
    echo Install dependensi gagal. Periksa koneksi internet.
    pause
    exit /b 1
  )
)

netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Server sudah berjalan di http://localhost:3000
  start "" "http://localhost:3000"
  exit /b 0
)

echo Memulai AI MikroTik Assistant di http://localhost:3000
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

node server.js
echo Server berhenti.
pause
