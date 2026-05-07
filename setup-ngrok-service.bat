@echo off

net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

schtasks /create /tn "NovaStudio-NgrokWatchdog" /sc ONSTART /ru SYSTEM /f /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"C:\сервер 2\ngrok-watchdog.ps1\""
if %errorlevel%==0 (
    echo [OK] Watchdog registered!
    schtasks /run /tn "NovaStudio-NgrokWatchdog"
    echo [OK] Watchdog started.
) else (
    echo [ERROR] Failed to register task.
)
pause
