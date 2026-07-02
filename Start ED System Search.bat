@echo off
setlocal
cd /d "%~dp0"
title Elite Dangerous System Search

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js or start this from a terminal where node is available.
  echo.
  pause
  exit /b 1
)

echo Starting Elite Dangerous System Search...
echo Project: %cd%
echo URL: http://localhost:5177
echo.

start "" "http://localhost:5177"

rem Run node directly (not via npm) so Ctrl+C reaches the server's shutdown
rem guard instead of being intercepted by an npm wrapper process.
node server.js
set EXITCODE=%errorlevel%

echo.
if "%EXITCODE%"=="0" (
  echo Server stopped.
) else if "%EXITCODE%"=="2" (
  echo Startup aborted -- the running copy is busy writing data ^(import or
  echo journal scan^). It was left alone to avoid corrupting your data.
  echo The browser tab that just opened is served by that running copy.
  echo Wait for it to finish, then relaunch if you still need a restart.
) else if "%EXITCODE%"=="3" (
  echo Startup aborted -- port 5177 is used by a different program, not this
  echo app. Close that program or set the PORT environment variable, then
  echo relaunch.
) else if "%EXITCODE%"=="4" (
  echo Startup aborted -- the previous copy could not be stopped and still
  echo holds port 5177. Close it manually ^(check Task Manager for node.exe^),
  echo then relaunch.
) else (
  echo Server exited with an error ^(code %EXITCODE%^). See the messages above
  echo for details.
)
pause
