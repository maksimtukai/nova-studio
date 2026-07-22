@echo off
where ngrok >nul 2>nul
if %errorlevel% neq 0 (
    echo ngrok не найден. Помести ngrok.exe рядом с этим файлом.
    pause
    exit /b
)

ngrok http 43219 --config=ngrok.yml --region=eu --log=stdout --log-level=warn
pause
