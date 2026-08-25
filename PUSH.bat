@echo off
setlocal EnableExtensions
title A2Z STAFF PORTAL - push and go live
REM ============================================================
REM  A2Z STAFF PORTAL - PUSH.bat
REM
REM  Double-click this. It sends the code in THIS folder to GitHub;
REM  Cloudflare builds and publishes it by itself (see
REM  AUTO-DEPLOY.md). Then this window CHECKS the live portal and
REM  prints the version it is running.
REM
REM  DEPLOY.bat is the emergency route only - Cloudflare refuses a
REM  direct deploy while the worker is connected to the repository.
REM ============================================================

cd /d "%~dp0"
set "TMPH=%TEMP%\a2z-health.txt"

echo.
echo   A2Z STAFF PORTAL - push and go live
echo   ===================================
echo.

if not exist ".git" (
  echo   [X] This folder is not connected to git, so there is
  echo       nothing to push. Send this message over.
  echo.
  pause
  exit /b 1
)

set "PKG="
for /f "tokens=2 delims=:, " %%v in ('findstr /C:"\"version\"" package.json') do if not defined PKG set "PKG=%%~v"
echo   Version in this folder: %PKG%
echo.

echo   [1/4] Checking what changed...
git add -A
git status --short
echo.

echo   [2/4] Saving the change...
git commit -m "Portal v%PKG% - ELFIA discount and homepage carousel"
if errorlevel 1 (
  echo.
  echo       Nothing new to save - already committed. Pushing anyway,
  echo       in case it never reached GitHub.
  echo.
)

echo   [3/4] Sending to GitHub...
git push
if errorlevel 1 (
  echo.
  echo   ============================================
  echo    [X] THE PUSH WAS REFUSED. Nothing is live.
  echo   ============================================
  echo    Usual reasons:
  echo      * not signed in to GitHub on this computer
  echo      * someone else changed the repo - run:  git pull
  echo        then double-click this file again
  echo.
  echo    Copy this window and send it over.
  echo.
  pause
  exit /b 1
)
echo.
echo       Sent. Cloudflare is building now - 1 to 3 minutes.
echo       Leave this window open.
echo.

echo   [4/4] Watching the live portal...
echo.
REM  Counter + goto, NOT a for-loop calling a subroutine: "goto" out
REM  of a CALLed label only returns to the loop and would keep
REM  polling after the portal was already up.
set /a TRIES=0

:poll
set /a TRIES+=1
timeout /t 20 /nobreak >nul
curl.exe -s -m 20 https://a2zcreative.my/api/v1/health > "%TMPH%" 2>nul
type "%TMPH%"
echo.
findstr /C:"\"version\":\"%PKG%\"" "%TMPH%" >nul && goto :live
if %TRIES% LSS 20 goto :poll

echo.
echo   ============================================
echo    [!] Still not showing v%PKG% after 7 minutes.
echo   ============================================
echo    The push worked, so the build is either still running
echo    or it failed. Look here:
echo      Cloudflare - Workers and Pages - azoneofficial - Builds
echo    Send over whatever the newest build says.
echo.
pause
exit /b 1

:live
echo.
echo   ============================================
echo    DONE - v%PKG% is LIVE on a2zcreative.my
echo   ============================================
echo.
echo    IMPORTANT - this version adds two database columns, and
echo    Cloudflare's build does NOT run migrations. Run this once,
echo    now, or the ELFIA tab will say "migration missing":
echo.
echo      cd worker
echo      npx wrangler d1 migrations apply azoneofficial --remote
echo.
echo    Then in the portal - ELFIA Store tab you get:
echo      * Discount RM on every product
echo      * Homepage carousel - add, caption, reorder, remove
echo.
pause
exit /b 0
