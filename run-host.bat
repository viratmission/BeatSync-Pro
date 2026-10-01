@echo off
title BeatSync-Pro — Master Laptop Host
color 0B

echo ======================================================================
echo          BEATSYNC-PRO — OFFLINE LAN VIDEO + AUDIO SYNC
echo ======================================================================
echo.
echo Starting BeatSync-Pro Master Host...
echo Binding to 0.0.0.0:8080 (Local Wi-Fi / LAN)
echo.

:: Detect Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not found in PATH!
    echo Please install Python 3.10+ from python.org or Microsoft Store.
    pause
    exit /b 1
)

:: Run backend main.py
python backend\main.py --port 8080

pause
