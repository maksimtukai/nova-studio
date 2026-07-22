@echo off
title CLOUDFLARE TUNNEL
color 0B
cd /d "%~dp0"

echo Stopping old tunnels...
taskkill /IM cloudflared.exe /F >nul 2>&1
taskkill /IM ngrok.exe /F >nul 2>&1

if not exist cloudflared.exe (
    echo cloudflared.exe not found. Run start-all or download from GitHub releases.
    pause
    exit /b 1
)

echo.
if exist cloudflared.yml (
    echo Starting named tunnel from cloudflared.yml...
    start "" cloudflared tunnel --config cloudflared.yml run
) else (
    echo Starting quick tunnel on port 43219...
    start "" cloudflared tunnel --url http://localhost:43219 --metrics localhost:20241 --logfile .cloudflared.log --loglevel info
)

echo.
echo Tunnel starting. URL will appear in server.url or launcher.
echo.
pause
