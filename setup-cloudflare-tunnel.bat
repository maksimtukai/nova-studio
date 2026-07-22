@echo off
title SETUP CLOUDFLARE TUNNEL
color 0B
cd /d "%~dp0"

if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-cloudflare-tunnel.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-cloudflare-tunnel.ps1" -Hostname "%~1"
)

echo.
pause
