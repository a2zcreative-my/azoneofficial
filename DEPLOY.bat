@echo off
REM ============================================================
REM  AZ ONE OFFICIAL - ONE-CLICK DEPLOY (v1.11.1)
REM  Put this file INSIDE the azoneofficial-main folder and
REM  double-click it. It always runs from its own folder, so the
REM  "wrong directory" problem cannot happen.
REM
REM  There are TWO workers to publish:
REM    1. azoneofficial-api  -> worker\wrangler.toml  (the API, and
REM       the ONLY config that carries the D1 binding, so all
REM       migrations must run from inside worker\)
REM    2. azoneofficial      -> wrangler.toml (root)   (the website
REM       itself, uploaded as Workers assets from out\)
REM  Older copies of this script only deployed the API and left the
REM  freshly built site sitting in out\, unpublished.
REM ============================================================
setlocal
cd /d "%~dp0"

if not exist wrangler.toml (
  echo.
  echo [X] WRONG FOLDER: this DEPLOY.bat must sit INSIDE the
  echo     azoneofficial-main folder ^(next to wrangler.toml^).
  echo     Move it there, then double-click it again.
  echo.
  pause
  exit /b 1
)

if not exist worker\wrangler.toml (
  echo.
  echo [X] MISSING worker\wrangler.toml - the API config is not in
  echo     this folder. Unzip the full delivery again, do not merge
  echo     it into an older copy.
  echo.
  pause
  exit /b 1
)

echo ============================================
echo  AZ ONE OFFICIAL - one-click deploy
echo  Folder: %CD%
echo ============================================
echo.

echo [1/5] Installing dependencies...
call pnpm install
if %errorlevel% neq 0 goto :failed
echo.

echo [2/5] Applying database migrations...
REM  CI=true is REQUIRED: without it wrangler shows an interactive
REM  "About to apply N migration(s) - continue? (y/n)" prompt. A
REM  double-clicked .bat is an interactive console, so the script
REM  would stall there - and worse, answering "n" makes wrangler
REM  exit 0, so the errorlevel check would pass and the rest of the
REM  deploy would publish a new site against an UN-MIGRATED database.
set CI=true
pushd worker
call npx wrangler d1 migrations apply azoneofficial --remote
if %errorlevel% neq 0 (
  popd
  set CI=
  goto :failed
)
popd
set CI=
echo.

echo [3/5] Deploying the API worker...
pushd worker
call npx wrangler deploy
if %errorlevel% neq 0 (
  popd
  goto :failed
)
popd
echo.

echo [4/5] Building the website...
call pnpm build
if %errorlevel% neq 0 goto :failed
echo.

echo [5/5] Publishing the website...
call npx wrangler deploy
if %errorlevel% neq 0 goto :failed
echo.

echo ============================================
echo  DONE - everything is live.
echo ============================================
echo.
echo  Check these before you close this window:
echo    1. https://a2zcreative.my                   loads
echo       ^(azoneofficial.com must keep loading too^)
echo    2. https://a2zcreative.my/api/v1/health     responds
echo       and https://azoneofficial.com/api/v1/health too
echo    3. Sign in at /login, open /portal on your
echo       phone - the bottom bar shows an icon per
echo       tab and the active one is a navy square
echo    4. /admin and /account look the same way
echo    5. Clock in once - if the office geofence is
echo       on, it must ask for your location
echo.
pause
exit /b 0

:failed
echo.
echo ============================================
echo  [X] A STEP FAILED - nothing further was run.
echo ============================================
echo  Scroll up to the last red/error text and send
echo  it over. The site is untouched if this failed
echo  before step 5.
echo.
pause
exit /b 1
