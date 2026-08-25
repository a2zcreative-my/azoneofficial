@echo off
setlocal EnableExtensions
title A2Z STAFF PORTAL - go live
REM ============================================================
REM  A2Z STAFF PORTAL - PUSH.bat  (v2)
REM
REM  Same trap as the ELFIA store: this project is TWO things.
REM
REM    1. THE WEBSITE (the portal pages) - deploys BY ITSELF when
REM       this folder is pushed to GitHub.
REM    2. THE ENGINE  (worker "azoneofficial-api" - the database,
REM       the ELFIA bridge feed) - does NOT deploy from GitHub. It
REM       is published from this computer, step 4 below.
REM
REM  The ELFIA Store tab's Discount and Homepage carousel live in
REM  the ENGINE, so pushing alone will not switch them on.
REM ============================================================

cd /d "%~dp0"
set "TMPH=%TEMP%\a2z-health.txt"

echo.
echo   A2Z STAFF PORTAL - go live
echo   ==========================
echo.

if not exist ".git"                 goto :nogit
if not exist "worker\wrangler.toml" goto :noworker

set "PKG="
for /f "tokens=2 delims=:, " %%v in ('findstr /C:"\"version\"" package.json') do if not defined PKG set "PKG=%%~v"
echo   Version in this folder: %PKG%
echo.

echo   [1/5] Checking you are signed in to Cloudflare...
pushd worker
call npx wrangler whoami >nul 2>&1
if errorlevel 1 (
  popd
  echo.
  echo   [X] Not signed in to Cloudflare. Fix it once:
  echo         cd worker
  echo         npx wrangler login
  echo       Then double-click this file again.
  echo.
  pause
  exit /b 1
)
popd
echo         signed in.
echo.

echo   [2/5] Sending the portal website to GitHub...
git add -A
git status --short
git commit -m "Portal v%PKG% - ELFIA discount and homepage carousel"
if errorlevel 1 echo         nothing new to save - pushing anyway.
git push
if errorlevel 1 (
  echo.
  echo   [X] THE PUSH WAS REFUSED - the portal pages will not
  echo       update. Try:  git pull   then run this again.
  echo       Copy this window and send it over.
  echo.
  pause
  exit /b 1
)
echo         sent.
echo.

echo   [3/5] Adding the new database columns (discount, slides)...
set CI=true
pushd worker
call npx wrangler d1 migrations apply azoneofficial --remote
if errorlevel 1 (
  popd
  set CI=
  echo.
  echo   [X] The database step failed. NOTHING was published - the
  echo       live portal is untouched and still working. Send the
  echo       lines above over.
  echo.
  pause
  exit /b 1
)
popd
set CI=
echo.

echo   [4/5] Publishing the ENGINE...
pushd worker
call npx wrangler deploy
if errorlevel 1 (
  popd
  echo.
  echo   ============================================
  echo    [X] THE ENGINE DID NOT PUBLISH.
  echo   ============================================
  echo    The ELFIA tab will still show, but Discount and the
  echo    Homepage carousel will report a missing migration until
  echo    this step works.
  echo.
  echo    If the error mentions the worker being connected to a
  echo    REPOSITORY:
  echo      Cloudflare - Workers and Pages - azoneofficial-api
  echo      - Settings - Build - Disconnect, run this again,
  echo      then reconnect it afterwards.
  echo.
  pause
  exit /b 1
)
popd
echo.

echo   [5/5] Checking the live portal...
echo.
set /a TRIES=0

:poll
set /a TRIES+=1
timeout /t 10 /nobreak >nul
curl.exe -s -m 20 https://a2zcreative.my/api/v1/health > "%TMPH%" 2>nul
type "%TMPH%"
echo.
findstr /C:"\"version\":\"%PKG%\"" "%TMPH%" >nul && goto :live
if %TRIES% LSS 12 goto :poll

echo.
echo   [!] The live portal still does not say v%PKG%. Send this
echo       window over.
echo.
pause
exit /b 1

:live
echo.
echo   ============================================
echo    DONE - v%PKG% is LIVE on a2zcreative.my
echo   ============================================
echo.
echo    In the portal - ELFIA Store tab you now have:
echo      * Discount RM on every product (shows the customer price
echo        before you leave the field)
echo      * Homepage carousel - add a photo, caption it, reorder,
echo        hide or remove. The shop mirrors this list exactly.
echo.
pause
exit /b 0

:nogit
echo   [X] This folder is not connected to git. Send this over.
echo.
pause
exit /b 1

:noworker
echo   [X] worker\wrangler.toml is missing - not the full project
echo       folder. Send this over.
echo.
pause
exit /b 1
