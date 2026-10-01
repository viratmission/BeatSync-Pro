@echo off
title BeatSync-Pro — Windows Firewall Setup
color 0E

echo ======================================================================
echo          BEATSYNC-PRO — WINDOWS FIREWALL CONFIGURATION
echo ======================================================================
echo.
echo This script opens inbound TCP port 8080 on Windows Defender Firewall
echo so phones on your local Wi-Fi / Hotspot can connect to this laptop.
echo.
echo NOTE: Must be run as Administrator!
echo.

net session >nul 2>&1
if not %errorLevel% == 0 (
    echo [WARNING] Not running as Administrator!
    echo Please right-click this batch file and select "Run as administrator".
    echo.
    echo Alternatively, run this command in an Administrator PowerShell:
    echo   netsh advfirewall firewall add rule name="BeatSync-Pro LAN" dir=in action=allow protocol=TCP localport=8080
    echo.
    pause
    exit /b 1
)

echo Adding Windows Firewall Rule for BeatSync-Pro (TCP Port 8080)...
netsh advfirewall firewall delete rule name="BeatSync-Pro LAN" >nul 2>&1
netsh advfirewall firewall add rule name="BeatSync-Pro LAN" dir=in action=allow protocol=TCP localport=8080

if %errorLevel% == 0 (
    echo.
    echo [SUCCESS] Firewall rule 'BeatSync-Pro LAN' successfully added!
    echo Phones on your local Wi-Fi network can now connect to port 8080.
) else (
    echo.
    echo [ERROR] Failed to add firewall rule.
)

echo.
pause
