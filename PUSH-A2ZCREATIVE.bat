@echo off
setlocal
title A2Z OS - push a2zcreative.my (portal only)
REM ============================================================
REM  PUSH-A2ZCREATIVE.bat  -  publishes a2zcreative.my ONLY.
REM
REM  Lives in:  C:\Users\Alif\Desktop\a2zcreative-official\
REM
REM  What it publishes (both, every time):
REM    * azoneofficial-api  - the engine  (worker\, a2zcreative.my/api/*)
REM    * azoneofficial      - the website (out\,   a2zcreative.my)
REM
REM  It does NOT touch:
REM    * azoneofficial.com  (use PUSH-AZONEOFFICIAL.bat in that folder)
REM    * the ELFIA store    (paused)
REM
REM  WHY A WRAPPER: PUSH.bat already holds every hardened step -
REM  preflight, guards, migration backup + apply, engine compile +
REM  deploy with retry, website build + deploy, GitHub save and the
REM  live health check. "PUSH.bat portal" runs exactly those steps
REM  for the portal alone. Copying 36 KB of that logic here would
REM  give two files to keep in step, so this file calls it instead.
REM
REM  Extra words are passed through, e.g.
REM    PUSH-A2ZCREATIVE.bat strict
REM    PUSH-A2ZCREATIVE.bat skip-pre-export
REM ============================================================

cd /d "%~dp0"

if not exist "%~dp0PUSH.bat" (
  echo.
  echo   PUSH.bat is not in this folder. This file must sit in
  echo   C:\Users\Alif\Desktop\a2zcreative-official\ beside PUSH.bat.
  goto :stop
)
if not exist "%~dp0worker\wrangler.toml" (
  echo.
  echo   worker\wrangler.toml is missing - this is not the A2Z OS
  echo   portal folder. Nothing was pushed.
  goto :stop
)
findstr /C:"a2zcreative.my/api/*" "%~dp0worker\wrangler.toml" >nul
if errorlevel 1 (
  echo.
  echo   worker\wrangler.toml does not route a2zcreative.my/api/*.
  echo   Refusing to push - check you are in the right folder.
  goto :stop
)

echo.
echo   ============================================
echo    Publishing a2zcreative.my  (A2Z OS portal)
echo    azoneofficial.com and ELFIA are NOT touched.
echo   ============================================
echo.

call "%~dp0PUSH.bat" portal %*
set "RC=%errorlevel%"
endlocal & exit /b %RC%

:stop
echo.
pause
endlocal & exit /b 1
