@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
if errorlevel 1 (
  echo Calendar could not be stopped. See the message above.
  pause
  exit /b 1
)

endlocal
