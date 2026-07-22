@echo off
title NGROK AUTO STARTER
color 0B

echo Закрываю старые процессы ngrok...
taskkill /IM ngrok.exe /F >nul 2>&1

echo.
echo Запускаю ngrok на порту 43219 с оптимизацией...
start "" ngrok http 43219 --config=ngrok.yml --region=eu --log=stdout --log-level=warn

echo.
echo NGROK запущен с оптимизацией. Открой ссылку из окна ngrok.
echo.
pause
