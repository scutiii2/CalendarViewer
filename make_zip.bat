@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0make_zip.py" %*
  goto :result
)
where python >nul 2>nul
if not errorlevel 1 (
  python "%~dp0make_zip.py" %*
  goto :result
)
echo Python 3 was not found. Install Python 3, then run this file again.
pause
exit /b 1

:result
if errorlevel 1 (
  echo ZIP creation failed.
  pause
  exit /b 1
)
pause
endlocal
