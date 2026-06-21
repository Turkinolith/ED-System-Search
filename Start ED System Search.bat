@echo off
setlocal

cd /d "%~dp0"
title Elite Dangerous System Search

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH.
  echo Install Node.js or start this from a terminal where npm is available.
  echo.
  pause
  exit /b 1
)

echo Starting Elite Dangerous System Search...
echo Project: %cd%
echo URL: http://localhost:5177
echo.

start "" "http://localhost:5177"
call npm start

echo.
echo Server stopped.
pause
