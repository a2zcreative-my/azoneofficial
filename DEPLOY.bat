@echo off
REM ============================================================
REM  A2Z CREATIVE MARKETING - ONE-CLICK DEPLOY  (v1.29.4)
REM
REM  New in this version, after the 19-08 login outage:
REM   * STEP 3 COMPILES THE API CODE BEFORE PUBLISHING IT.
REM     v1.29.0 shipped a line referencing something that did not
REM     exist ("url is not defined"). Nothing caught it, because
REM     the root typecheck EXCLUDES the worker folder and wrangler
REM     bundles without resolving types - so a broken build went
REM     live and every signed-in page returned 500. That check now
REM     runs here and refuses to deploy code that cannot work.
REM   * It refuses to run from an old folder (package.json must
REM     say 1.29.4) - deploying stale code caused the same outage.
REM   * It CHECKS the live API itself after publishing and prints
REM     the version, so you see the result without asking anyone.
REM
REM  Two workers get published:
REM    1. azoneofficial-api  -> worker\wrangler.toml  (the engine +
REM       the D1 binding, so migrations run from inside worker\)
REM    2. azoneofficial      -> wrangler.toml (root)  (the website,
REM       uploaded as Workers assets from out\)
REM ============================================================
setlocal
cd /d "%~dp0"

if not exist wrangler.toml (
  echo.
  echo [X] WRONG FOLDER: DEPLOY.bat must sit INSIDE the project
  echo     folder, next to wrangler.toml.
  echo.
  pause
  exit /b 1
)

if not exist worker\wrangler.toml (
  echo.
  echo [X] MISSING worker\wrangler.toml - the API config is not in
  echo     this folder. Unzip the full delivery again into an EMPTY
  echo     folder. Never merge it into an older copy.
  echo.
  pause
  exit /b 1
)

findstr /C:"\"version\": \"1.29.4\"" package.json >nul
if %errorlevel% neq 0 (
  echo.
  echo [X] THIS IS NOT THE v1.29.4 FOLDER.
  echo     Deploying an older folder is what broke the new domain.
  echo     Unzip a2z-v1.29.4-FULL.zip into a NEW EMPTY folder and
  echo     run the DEPLOY.bat that is inside it.
  echo.
  pause
  exit /b 1
)

echo ============================================
echo  A2Z CREATIVE - one-click deploy  v1.29.4
echo  Folder: %CD%
echo ============================================
echo.

echo [1/8] Installing website dependencies...
call pnpm install
if %errorlevel% neq 0 goto :failed
echo.

echo [2/8] Installing API dependencies...
REM  v1.29.4: npm refuses to install when wrangler's OPTIONAL peer wants a
REM  newer @cloudflare/workers-types than this folder pins (ERESOLVE). The
REM  pin now matches wrangler, so the plain install works - but wrangler
REM  bumps that peer every few weeks, and a deploy must never be blocked at
REM  midnight by a type-definition version. If it happens again, retry the
REM  way npm itself suggests, and only give up if THAT fails too.
REM  NOTE for whoever edits this next: the retry uses "if errorlevel 1",
REM  NOT "if %%errorlevel%% neq 0". Inside a parenthesised block cmd.exe
REM  expands %%errorlevel%% when it PARSES the block, so the nested check
REM  would test the value from before npm ran - and silently pass.
pushd worker
call npm install --no-audit --no-fund
if not errorlevel 1 goto :apideps_ok
echo.
echo    [!] npm refused the dependency tree - retrying with
echo        --legacy-peer-deps ^(this only relaxes an optional TYPE
echo        definition version; it cannot change what gets deployed^).
echo.
call npm install --no-audit --no-fund --legacy-peer-deps
if errorlevel 1 (
  popd
  goto :failed
)
:apideps_ok
popd
echo.

echo [3/8] Compiling the API code (the check that was missing)...
call node tests\worker-compile-gate.mjs
if %errorlevel% neq 0 (
  echo.
  echo  [X] The API code did not pass. NOTHING was deployed and the
  echo      live system is untouched. Send the lines above over.
  echo.
  pause
  exit /b 1
)
echo.

echo [4/8] Applying database migrations...
REM  CI=true is REQUIRED: without it wrangler shows an interactive
REM  "About to apply N migration(s) - continue?" prompt, and "n"
REM  exits 0 - which would deploy against an UN-MIGRATED database.
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

echo [5/8] Deploying the API worker (this is what makes login work)...
pushd worker
call npx wrangler deploy
if %errorlevel% neq 0 (
  popd
  echo.
  echo  [X] The API worker did NOT publish. Nothing else will run.
  echo      If the error mentions a ROUTE already assigned to
  echo      another worker, that other worker is holding the
  echo      domain - send the message over.
  goto :failed
)
popd
echo.

echo [6/8] Checking the live API on a2zcreative.my...
echo.
echo    --- https://a2zcreative.my/api/v1/health
curl.exe -s -m 20 https://a2zcreative.my/api/v1/health
echo.
echo.
echo    Expected: {"ok":true,"db":true,"version":"1.29.4"}
echo    That line means a2zcreative.my can sign in NOW.
echo    A blank line or an error means the domain is not routed to
echo    this worker - copy this window and send it over.
echo.

echo [7/8] Building the website...
call pnpm build
if %errorlevel% neq 0 goto :failed
echo.

echo [8/8] Publishing the website...
call npx wrangler deploy
if %errorlevel% neq 0 (
  echo.
  echo  ============================================
  echo   [!] THE WEBSITE STEP WAS REFUSED.
  echo  ============================================
  echo   The API above is already live, so signing in
  echo   works. This step fails for ONE usual reason:
  echo   the worker "azoneofficial" is still connected
  echo   to a GitHub repository, and Cloudflare will
  echo   not let this script publish over a
  echo   git-connected worker.
  echo.
  echo   Fix it once, then run this file again:
  echo     Cloudflare - Workers and Pages - azoneofficial
  echo     - Settings - Build - Disconnect the repository
  echo.
  pause
  exit /b 1
)
echo.

echo ============================================
echo  DONE - everything is live.
echo ============================================
echo.
echo    --- https://a2zcreative.my/api/v1/health
curl.exe -s -m 20 https://a2zcreative.my/api/v1/health
echo.
echo.
echo  Then check by hand:
echo    1. https://a2zcreative.my/login  signs in
echo    2. Attendance - click a session - Mark completed
echo       shows the same confirmation popup as Save
echo    3. /portal on your phone - bottom bar icons correct
echo    4. Clock in once - it must ask for your location
echo.
pause
exit /b 0

:failed
echo.
echo ============================================
echo  [X] A STEP FAILED - nothing further was run.
echo ============================================
echo  Scroll up to the last error text and send it
echo  over. Nothing was published after the failure.
echo.
pause
exit /b 1
