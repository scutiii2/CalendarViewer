@echo off
rem ICS Calendar Viewer launcher: double-click for a menu, or pass an action (start, stop, startup-on, startup-off, zip).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\calendar.ps1" %*
if errorlevel 1 pause
