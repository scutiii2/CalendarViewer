@echo off
rem ICS Calendar Viewer launcher. Double-click for a menu, or pass one action:
rem   start, stop, startup-on (optional --browser), startup-off, zip
setlocal EnableExtensions
cd /d "%~dp0"

set "OPT=%~2"
if not "%~1"=="" (
  set "INTERACTIVE="
  set "ACTION=%~1"
  goto :dispatch
)
set "INTERACTIVE=1"

:menu
cls
echo ICS Calendar Viewer
echo.
echo   1. Start or restart the server and open the calendar
echo   2. Stop the server
echo   3. Start the server automatically at Windows sign-in
echo   4. Turn off automatic startup
echo   5. Create a distribution ZIP
echo   Q. Quit
echo.
set "CHOICE=1"
set /p "CHOICE=Choose an option [1]: "
set "ACTION="
if "%CHOICE%"=="1" set "ACTION=start"
if "%CHOICE%"=="2" set "ACTION=stop"
if "%CHOICE%"=="3" set "ACTION=startup-on"
if "%CHOICE%"=="4" set "ACTION=startup-off"
if "%CHOICE%"=="5" set "ACTION=zip"
if /i "%CHOICE%"=="q" exit /b 0
if not defined ACTION (
  echo Unknown option.
  pause
  goto :menu
)

:dispatch
if /i "%ACTION%"=="start" call :start & goto :finish
if /i "%ACTION%"=="stop" call :stop & goto :finish
if /i "%ACTION%"=="startup-on" call :startup_on & goto :finish
if /i "%ACTION%"=="startup-off" call :startup_off & goto :finish
if /i "%ACTION%"=="zip" call :zip & goto :finish
echo Unknown action "%ACTION%". Use: start, stop, startup-on [--browser], startup-off, zip.
exit /b 1

:finish
set "RC=%errorlevel%"
if defined INTERACTIVE (
  pause
  goto :menu
)
if not "%RC%"=="0" pause
exit /b %RC%

:start
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js, then run this file again.
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
if errorlevel 1 (
  echo Calendar could not start. See the message above.
  exit /b 1
)
exit /b 0

:stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
if errorlevel 1 (
  echo Calendar could not be stopped. See the message above.
  exit /b 1
)
exit /b 0

:startup_on
rem By default only the server starts at sign-in; --browser also opens the calendar.
set "FLAGS=-NoBrowser"
if /i "%OPT%"=="--browser" set "FLAGS="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_startup.ps1" %FLAGS%
if errorlevel 1 (
  echo Startup configuration failed. See the message above.
  exit /b 1
)
exit /b 0

:startup_off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_startup.ps1" -Remove
if errorlevel 1 (
  echo Could not remove calendar startup. See the message above.
  exit /b 1
)
exit /b 0

:zip
where py >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0make_zip.py"
  goto :zip_result
)
where python >nul 2>nul
if not errorlevel 1 (
  python "%~dp0make_zip.py"
  goto :zip_result
)
echo Python 3 was not found. Install Python 3, then run this file again.
exit /b 1

:zip_result
if errorlevel 1 (
  echo ZIP creation failed.
  exit /b 1
)
exit /b 0
