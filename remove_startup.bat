@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_startup.ps1" -Remove
if errorlevel 1 (
  echo Could not remove calendar startup. See the message above.
  pause
  exit /b 1
)
pause
endlocal
