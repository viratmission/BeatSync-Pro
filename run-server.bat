@echo off
title BeatSync-Pro — Server Headless
color 0A

echo ======================================================================
echo          BEATSYNC-PRO — HEADLESS SERVER RUNNER
echo ======================================================================
echo.

python backend\main.py --port 8080 --no-browser

pause
