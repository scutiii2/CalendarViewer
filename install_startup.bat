@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_startup.ps1" %*
if errorlevel 1 (
  echo Startup configuration failed. See the message above.
  pause
  exit /b 1
)
pause
endlocal
