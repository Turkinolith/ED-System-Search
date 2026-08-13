@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ED System Search Updater

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js, then run this updater again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH.
  echo Reinstall Node.js, then run this updater again.
  echo.
  pause
  exit /b 1
)

:menu
cls
echo ============================================================
echo                  ED System Search Updater
echo ============================================================
echo.
echo This runs data-import scripts only. It does NOT start the server.
echo Close the app first if you want it to show the new data immediately.
echo.
echo System-map updates
echo   1. Download and import the last 1 day
echo   2. Download and import the last 1 week
echo   3. Download and import the last 2 weeks
echo   4. Download and import the last 1 month
echo   5. Download and import the last 6 months
echo   6. Finish a system-map update (spatial index and journals)
echo.
echo Rich galaxy updates
echo   7. Download and import the last 1 day
echo   8. Download and import the last 7 days
echo   9. Download and import the last 1 month
echo   A. Rebuild System Features filter data only
echo.
echo Other refreshes and rebuilds
echo   B. Refresh Elite Dangerous journals
echo   C. Rebuild Green Gas Giant candidates
echo   D. Refresh place data and its index
echo   E. Refresh discovery data and its index
echo   F. Refresh search suggestions
echo   G. Rebuild the spatial index
echo   H. Refresh region vectors
echo   I. Import a local systems.json.gz full dump
echo   J. Import galaxy.json.gz beside this updater (no download)
echo   K. Import a different local galaxy dump (paste or drag its path)
echo   L. Download and import the full galaxy dump (very large)
echo   M. Clean up stranded temporary import files
echo   N. Repack the completed rich galaxy with dictionary compression
echo.
echo   0. Exit
echo.
set "selection=%~1"
if not defined selection set /p "selection=Choose an update: "

if "%selection%"=="1" (call :run "import:systems-delta:1day" & goto done)
if "%selection%"=="2" (call :run "import:systems-delta:1week" & goto done)
if "%selection%"=="3" (call :run "import:systems-delta:2weeks" & goto done)
if "%selection%"=="4" (call :run "import:systems-delta:1month" & goto done)
if "%selection%"=="5" (call :run "import:systems-delta:6months" & goto done)
if "%selection%"=="6" (call :run "import:systems-delta:finish" & goto done)
if "%selection%"=="7" (call :runNative "import:galaxy-delta:1day" & goto done)
if "%selection%"=="8" (call :runNative "import:galaxy-delta:7days" & goto done)
if "%selection%"=="9" (call :runNative "import:galaxy-delta:1month" & goto done)
if /i "%selection%"=="A" (call :runNative "import:galaxy-filters" & goto done)
if /i "%selection%"=="B" (call :run "refresh:journals" & goto done)
if /i "%selection%"=="C" (call :runNative "build:green-gas-giants" & goto done)
if /i "%selection%"=="D" (call :run "import:places" & goto done)
if /i "%selection%"=="E" (call :run "import:discoveries" & goto done)
if /i "%selection%"=="F" (call :run "import:suggestions" & goto done)
if /i "%selection%"=="G" (call :runNative "import:spatial-index" & goto done)
if /i "%selection%"=="H" (call :run "import:regions" & goto done)
if /i "%selection%"=="I" (call :run "import:systems" & goto done)
if /i "%selection%"=="J" (call :runNative "import:galaxy" & goto done)
if /i "%selection%"=="K" (call :importLocalGalaxy & goto done)
if /i "%selection%"=="L" (call :confirmFullGalaxy & goto done)
if /i "%selection%"=="M" (call :run "cleanup" & goto done)
if /i "%selection%"=="N" (call :repackGalaxy & goto done)
if "%selection%"=="0" exit /b 0

echo.
echo Please enter one of the listed choices.
pause
goto menu

:importLocalGalaxy
echo.
echo Paste the path to your downloaded galaxy .json.gz file, or drag the file into this window.
echo It will be imported directly and will not be downloaded again.
set "galaxySource="
set /p "galaxySource=Local galaxy dump path: "
set "galaxySource=%galaxySource:"=%"
if not defined galaxySource (
  echo No file was selected.
  set "EXITCODE=1"
  goto :eof
)
if not exist "%galaxySource%" (
  echo File not found: "%galaxySource%"
  set "EXITCODE=1"
  goto :eof
)
call :runNativeImporter "galaxy" "%galaxySource%"
goto :eof

:confirmFullGalaxy
echo.
echo This downloads and processes the full galaxy dump. It is a very large download.
set "confirm="
set /p "confirm=Type YES to continue: "
if /i not "%confirm%"=="YES" (
  echo Full-galaxy update cancelled.
  set "EXITCODE=0"
  goto :eof
)
call :runNative "import:galaxy:download"
goto :eof

:repackGalaxy
echo.
echo This rewrites the completed rich galaxy pack without downloading or re-parsing galaxy.json.gz.
echo It needs substantial temporary disk space and can take a long time. Existing data stays usable until validation succeeds.
set "confirm="
set /p "confirm=Type REPACK to continue: "
if /i not "%confirm%"=="REPACK" (
  echo Galaxy repack cancelled.
  set "EXITCODE=0"
  goto :eof
)
call :runNative "repack:galaxy"
goto :eof

:runNativeImporter
echo.
echo Preparing the native importer...
call npm run native:build
set "EXITCODE=%errorlevel%"
if not "%EXITCODE%"=="0" goto :eof
echo.
echo Running: node scripts\run-native-importer.js %~1 --source "%~2"
echo.
call node scripts\run-native-importer.js %~1 --source "%~2"
set "EXITCODE=%errorlevel%"
goto :eof

:runNative
echo.
echo Preparing the native importer...
call npm run native:build
set "EXITCODE=%errorlevel%"
if not "%EXITCODE%"=="0" goto :eof
call :run "%~1"
goto :eof

:run
echo.
echo Running: npm run %~1
echo.
call npm run %~1
set "EXITCODE=%errorlevel%"
goto :eof

:done
echo.
if "%EXITCODE%"=="0" (
  echo Update completed successfully.
) else (
  echo Update stopped with exit code %EXITCODE%.
  echo Review the messages above before trying again.
)
echo.
pause
exit /b %EXITCODE%
