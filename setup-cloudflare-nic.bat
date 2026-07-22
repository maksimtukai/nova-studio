@echo off
title CLOUDFLARE TUNNEL (nic.ru — bez smeny NS)
color 0B
cd /d "%~dp0"

echo.
echo Variant bez smeny NS-serverov.
echo Nuzhna tolko 1 zapic CNAME v nic.ru.
echo.

if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-cloudflare-tunnel.ps1" -Hostname "app.novastudio.ru" -ManualDns
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-cloudflare-tunnel.ps1" -Hostname "%~1" -ManualDns
)

pause
