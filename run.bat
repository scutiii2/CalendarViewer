@echo off
rem ICS Calendar Viewer: start the server if needed (or restart it after an update), then open the calendar.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\calendar.ps1" run %*
if errorlevel 1 pause
