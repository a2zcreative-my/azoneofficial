@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ELFIA + PORTAL - deploy everything
REM ============================================================
REM  ONE FILE. DOUBLE-CLICK IT. IT PUTS EVERYTHING LIVE.
REM
REM  There is an identical copy of this file in the other folder;
REM  it does not matter which one you run.
REM
REM  WHY THIS FILE EXISTS (the mistake that wasted 25-08):
REM  each project publishes TWO SEPARATE THINGS, and deploying
REM  one without the other is what made new features look broken:
REM
REM    a2zcreative-official
REM      * azoneofficial-api  - the engine   (worker\ folder)
REM      * azoneofficial      - the WEBSITE  (repo root, out\)
REM    elfiaofficialstore
REM      * elfia-api          - the engine   (worker\ folder)
REM      * elfia-store        - the WEBSITE  (Cloudflare Pages, out\)
REM
REM  On 25-08 the engines went live and the websites did not, so
REM  the portal kept showing the OLD carousel card with no way to
REM  reposition a photo, even though the feature was live in the
REM  engine underneath. This file always does all four, portal
REM  first (the shop reads from it), and checks the result itself.
REM
REM  v1.90.1: it also (a) puts the Threads app secrets on the ENGINE
REM  worker if they are missing - asked for on screen, never stored in
REM  this file - (b) compiles each engine before publishing it, and
REM  (c) retries an upload that lost its connection.
REM ============================================================

REM  Which folder am I sitting in? The portal has a wrangler.toml at its
REM  ROOT (its website is a worker); the store does not (its website is a
REM  Pages project). That one file tells the two apart with no guessing.
set "STORE=%~dp0"
set "PORTAL=%~dp0..\a2zcreative-official"
if exist "%~dp0wrangler.toml" set "PORTAL=%~dp0"
if exist "%~dp0wrangler.toml" set "STORE=%~dp0..\elfiaofficialstore"

echo.
echo   DEPLOY EVERYTHING
echo   =================
if /I "%~1"=="secrets" echo   ^(secrets mode: the Threads credentials will be asked for again^)
echo   Portal: %PORTAL%
echo   Store : %STORE%
echo.
echo   This takes about 5 minutes. Leave the window open until it
echo   says DONE.
echo.

if not exist "%PORTAL%\worker\wrangler.toml" goto :nofolders
if not exist "%STORE%\worker\wrangler.toml"  goto :nofolders

REM ============================================================
REM  PORTAL
REM ============================================================
echo.
echo   ========== PORTAL (a2zcreative.my) ==========
cd /d "%PORTAL%"

echo   [1/7] Checking the Cloudflare login...
cd worker
call npx wrangler whoami >nul 2>&1
if errorlevel 1 goto :nologin
cd ..
echo         signed in.

REM  v1.90.1 - THE THREADS SECRETS, ON THE RIGHT WORKER. The CEO set them
REM  from the repo root, which is the WEBSITE worker (azoneofficial); the
REM  engine (azoneofficial-api, worker\) never saw them and the Threads tab
REM  kept saying "not set". This step runs inside worker\ so the target
REM  cannot be wrong, asks Cloudflare which secrets the engine holds, and
REM  prompts only for the ones missing. Nothing you paste is written to
REM  any file or shown on screen - wrangler sends it straight to Cloudflare.
REM  v1.95.1 - REPLACING a secret, not just setting a missing one.
REM  Cloudflare returns secret NAMES, never values, so this step cannot tell
REM  a good secret from a stale, wrong or rotated one - only that something
REM  is stored under that name. It therefore prompts for what is MISSING and
REM  skips what exists, which left no way to replace a secret after a
REM  rotation. Run this file as:   PUSH.bat secrets
REM  and it prompts for both regardless, before deploying as usual.
echo   [2/7] Threads app credentials on the ENGINE...
cd worker
if /I "%~1"=="secrets" (
  echo         Replacing both - paste the CURRENT values from the Meta app
  echo         ^(Use cases - Threads API - Customize - Settings^).
  call :asksecret THREADS_APP_ID
  call :asksecret THREADS_APP_SECRET
) else (
  call npx wrangler secret list > "%TEMP%\azone-secrets.txt" 2>&1
  set "TH_MISSING="
  findstr /C:"THREADS_APP_ID" "%TEMP%\azone-secrets.txt" >nul
  if errorlevel 1 (set "TH_MISSING=1" & call :asksecret THREADS_APP_ID) else (echo         THREADS_APP_ID is set.)
  findstr /C:"THREADS_APP_SECRET" "%TEMP%\azone-secrets.txt" >nul
  if errorlevel 1 (set "TH_MISSING=1" & call :asksecret THREADS_APP_SECRET) else (echo         THREADS_APP_SECRET is set.)
  del "%TEMP%\azone-secrets.txt" >nul 2>&1
  REM  v1.95.2 - THE OFFER, on a timer. Cloudflare returns secret NAMES and
  REM  never values, so a secret that is set may still be stale, wrong, or
  REM  one you have just rotated - and this file is double-clicked, so
  REM  "run it with an argument" was no use. It asks once, waits five
  REM  seconds, and carries on by itself if nobody answers. A deploy left
  REM  running in another window still finishes on its own.
  if "!TH_MISSING!"=="" (
    choice /C YN /N /T 5 /D N /M "        Replace the Threads credentials now? [y/N] (continuing in 5s) "
    if errorlevel 2 (
      echo         Keeping the stored values.
    ) else (
      call :asksecret THREADS_APP_ID
      call :asksecret THREADS_APP_SECRET
    )
  )
)
cd ..

REM  v1.118.0 - PUSH NOTIFICATIONS NEED THREE KEYS ON THE ENGINE. Web push
REM  has been in the portal since v1.6.0, but the worker signs every push
REM  with a VAPID key pair it does not have until somebody sets it - and the
REM  setup was three commands in a source comment nobody ran. The CEO,
REM  06-09-2026: "cant it push notification on device (Mobile)?" - it can,
REM  once these exist. Same rules as the Threads step: runs inside worker\,
REM  asks Cloudflare which names exist, prompts only for what is missing,
REM  nothing pasted is written to any file. The keys are GENERATED here on
REM  this PC (npx web-push generate-vapid-keys) - they are never sent in
REM  chat or email. PUSH.bat secrets replaces them as it does the Threads
REM  ones.
echo   [2b/7] Push notification keys on the ENGINE...
cd worker
if /I "%~1"=="secrets" (
  call :askvapid
) else (
  call npx wrangler secret list > "%TEMP%\azone-secrets.txt" 2>&1
  set "VP_MISSING="
  findstr /C:"VAPID_PUBLIC_KEY" "%TEMP%\azone-secrets.txt" >nul
  if errorlevel 1 set "VP_MISSING=1"
  findstr /C:"VAPID_PRIVATE_KEY" "%TEMP%\azone-secrets.txt" >nul
  if errorlevel 1 set "VP_MISSING=1"
  findstr /C:"VAPID_SUBJECT" "%TEMP%\azone-secrets.txt" >nul
  if errorlevel 1 set "VP_MISSING=1"
  del "%TEMP%\azone-secrets.txt" >nul 2>&1
  if "!VP_MISSING!"=="" (
    echo         push keys are set - phones can subscribe.
  ) else (
    echo         One or more push keys are NOT set - no phone can receive
    echo         a notification until they are. Setting them now.
    call :askvapid
  )
)
cd ..

echo   [3/7] Installing what the build needs...
call pnpm install
if errorlevel 1 goto :failed

REM  v1.148.2 - same as the store's [1b/6] below: the repository is made to
REM  match its own .gitignore before anything is checked or published.
echo   [3b/7] Untracking anything .gitignore says should not be here...
for /f "delims=" %%F in ('git ls-files --cached --ignored --exclude-standard 2^>nul') do (
  git rm --cached --quiet "%%F" >nul 2>&1
)
for %%F in ("CHANGELOG-1.md" "CHANGELOG-2.md" "package-1.json" "package-2.json" "public\sw-1.js" "public\sw-2.js") do (
  if exist %%F del /f /q %%F
)

REM  v1.155.0 - RETIRED FEATURES. The CEO, 11-09-2026: "completely drop
REM  Criscikee since this project not going further". A file that is no
REM  longer referenced still compiles, still ships to git, and a guard file
REM  that is no longer registered FAILS registry-parity - so the files of a
REM  retired feature are removed here, on this machine, before anything is
REM  checked. Idempotent: once they are gone this loop touches nothing.
REM  Migration 0125 stays: a migration that has run is history, and the two
REM  tables it made sit unused until a later migration drops them.
echo   [3c/7] Removing the files of retired features...
for %%F in ("components\portal\criscikee-panel.tsx" "lib\criscikee.ts" "worker\src\criscikee.ts" "tests\criscikee.mjs" "scratch\criscikee-demo.sql") do (
  if exist %%F del /f /q %%F
)

REM  v1.90.1 - the engine is COMPILED before it is published (the 19-08
REM  outage: wrangler bundles without checking types, so a line naming
REM  something that does not exist goes live and every request 500s).
echo   [4/8] Checking the ENGINE code compiles...
call node tests\worker-compile-gate.mjs
if errorlevel 1 goto :failed

REM  v1.139.0 - AND EVERY OTHER GUARD, BEFORE ANYTHING IS PUBLISHED.
REM  The 08-09 audit found that this file ran exactly one of the 63 guards.
REM  The rest lived only in "npm run ci", which is the Cloudflare BUILD
REM  command - so a broken authorization rule, a wrong bridge price or a
REM  silent delete went live first and was reported in a build log
REM  afterwards. run-guards installs the API's type definitions itself if
REM  they are missing, so this needs nothing else.
echo   [5/8] Checking every rule that protects live data...
call node scripts\run-guards.mjs
if errorlevel 1 set PORTALGUARDS=1

REM  v1.148.0 - A PORTAL GUARD FAILURE NO LONGER SILENTLY BLOCKS THE STORE.
REM  This used to `goto :guardsfailed`, which ends the script - and the STORE
REM  section is below this line. So every failed portal guard run this month
REM  deployed nothing to ELFIA at all, and the store's catalogue fix sat
REM  undeployed for days while the screen said only that a portal rule was
REM  broken. The portal is still not published on a failure (its own data is
REM  what those rules protect); the store, which they say nothing about, is.
if defined PORTALGUARDS (
  echo.
  echo   [!] A PORTAL rule failed - the portal will NOT be published.
  echo       The store is independent of these rules and continues below.
  echo.
  goto :storesection
)

echo   [6/8] Database columns...
set CI=true
cd worker
call npx wrangler d1 migrations apply azoneofficial --remote
if errorlevel 1 goto :failedpop
cd ..
set CI=

echo   [7/8] Publishing the ENGINE (azoneofficial-api)...
cd worker
call :deployretry
if errorlevel 1 goto :failedpop
cd ..

echo   [8/8] Building and publishing the WEBSITE (azoneofficial)...
echo         ^(this is the half that was missing^)
call pnpm build
if errorlevel 1 goto :failed
if not exist "out\index.html" goto :nobuild
call :deployretry
if errorlevel 1 set SITEREFUSED=1

REM ============================================================
REM  STORE
REM ============================================================
:storesection
echo.
echo   ========== STORE (elfiaofficialstore.my) ==========
cd /d "%STORE%"

echo   [1/6] Installing what the build needs...
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

REM  v1.148.2 - MAKE THE REPOSITORY MATCH ITS OWN .gitignore, EVERY RUN.
REM  The 09-09 store deploy failed three times on CHANGELOG-1.md - 895 KB of
REM  the portal's changelog, agency identity and bank account inside the
REM  shop's repository. It was named in .gitignore the whole time and tracked
REM  anyway, because it was committed BEFORE the rule was written, and an
REM  ignore rule does nothing to a file git already tracks. A separate
REM  CLEAN-STRAYS.bat existed for this; a fix that lives in a file nobody
REM  runs is not a fix. So this does it here: anything git tracks that
REM  .gitignore says it should not is untracked, the known Windows copy
REM  collisions are deleted, and the commit step at the end records it.
REM  Idempotent - on a clean repository this touches nothing.
echo   [1b/6] Untracking anything .gitignore says should not be here...
for /f "delims=" %%F in ('git ls-files --cached --ignored --exclude-standard 2^>nul') do (
  git rm --cached --quiet "%%F" >nul 2>&1
)
for %%F in ("CHANGELOG-1.md" "CHANGELOG-2.md" "package-1.json" "package-2.json" "worker\src\index-1.ts" "worker\src\index-2.ts" "deploy-log.txt" "go-live-log.txt" "push-log.txt") do (
  if exist %%F del /f /q %%F
)
REM  out\ is rebuilt by next build two steps below.
if exist "out" rmdir /s /q "out"

echo   [2/6] Checking the ENGINE code compiles...
call node tests\worker-compile-gate.mjs
if errorlevel 1 goto :failed

REM  v1.148.0 - AND THE OTHER SIX. The 09-09 audit found this half ran
REM  exactly one of the store's seven guards, so the two that matter most -
REM  no-secrets (a committed credential) and payment-integrity (the money
REM  path) - were skipped by the one-click deploy everybody actually uses.
REM  The store has no scripts\run-guards.mjs of its own, so they are named
REM  here. A new guard file must be added to this list.
echo         ...and every other rule that protects live data
for %%G in (no-secrets payment-integrity brand-isolation migration-safety bank-line in-app-browser) do (
  if exist "tests\%%G.mjs" (
    call node tests\%%G.mjs
    if errorlevel 1 goto :storeguardsfailed
  )
)

echo   [3/6] Database columns...
set CI=true
cd worker
call npx wrangler d1 migrations apply elfia-store --remote
if errorlevel 1 goto :failedpop
cd ..
set CI=

echo   [4/6] Publishing the ENGINE (elfia-api)...
cd worker
call :deployretry
if errorlevel 1 goto :failedpop
cd ..

echo   [5/6] Building the shop...
call npx next build
if errorlevel 1 goto :failed
if not exist "out\index.html" goto :nobuild

echo   [6/6] Publishing the WEBSITE (elfia-store)...
call npx wrangler pages deploy out --project-name=elfia-store --commit-dirty=true
if errorlevel 1 set STOREREFUSED=1

REM ============================================================
REM  SAVE THE CODE (never blocks a deploy - it runs last)
REM ============================================================
echo.
echo   Saving both folders to GitHub (history only - the deploys
echo   above are already live)...
cd /d "%PORTAL%"
REM  v1.148.0 - point git at the tracked pre-commit gate before committing.
REM  Idempotent, and it survives a fresh clone (see .githooks/pre-commit for
REM  what .gitignore cannot do about a real signature scan).
if exist ".githooks\pre-commit" git config core.hooksPath .githooks >nul 2>&1
if defined PORTALGUARDS (
  echo   Portal code NOT saved to GitHub - a rule is broken; fix it first.
) else (
  git add -A >nul 2>&1
  git commit -m "portal deploy" >nul 2>&1
  git push >nul 2>&1
)
cd /d "%STORE%"
git add -A >nul 2>&1
git commit -m "store deploy" >nul 2>&1
git push >nul 2>&1

REM ============================================================
REM  CHECK THE LIVE SYSTEMS
REM ============================================================
echo.
echo   Checking both live systems...
echo.
echo     --- https://a2zcreative.my/api/v1/health
curl.exe -s -m 20 https://a2zcreative.my/api/v1/health
echo.
echo.
echo     --- https://elfiaofficialstore.my/api/v1/health
curl.exe -s -m 20 https://elfiaofficialstore.my/api/v1/health
echo.
echo.
REM  v1.139.0 - the website step used to EXIT here, so a refusal on the
REM  portal's pages meant the store - engine, migrations and all - was never
REM  deployed at all, and neither health check ran. A refusal is reported at
REM  the end now, after everything that CAN be published has been.
if defined SITEREFUSED goto :sitefailed
if defined STOREREFUSED goto :sitefailed
echo   ============================================
echo    DONE - engines AND websites are published.
echo   ============================================
echo.
echo    IMPORTANT: your browser is still holding the old pages.
echo    Open each one and press Ctrl+F5 (hold Ctrl, tap F5):
echo      1. https://a2zcreative.my/portal
echo      2. https://elfiaofficialstore.my
echo.
pause
exit /b 0

REM ------------------------------------------------------------
REM  helpers
REM ------------------------------------------------------------

:askvapid
REM  Runs INSIDE worker\. Generates a fresh key pair on this PC and shows it
REM  ONCE so the two halves can be pasted into the prompts that follow; the
REM  subject is the address push services may contact about abuse.
echo.
echo         Generating a VAPID key pair on this PC ^(nothing leaves it^)...
call npx --yes web-push generate-vapid-keys
echo.
echo         Copy the PUBLIC key above, paste it here and press Enter:
call npx wrangler secret put VAPID_PUBLIC_KEY
if errorlevel 1 echo         VAPID_PUBLIC_KEY was NOT saved ^(skipped or refused^).
echo         Now the PRIVATE key:
call npx wrangler secret put VAPID_PRIVATE_KEY
if errorlevel 1 echo         VAPID_PRIVATE_KEY was NOT saved ^(skipped or refused^).
echo         And the contact address, as  mailto:you@a2zcreative.com.my
call npx wrangler secret put VAPID_SUBJECT
if errorlevel 1 echo         VAPID_SUBJECT was NOT saved ^(skipped or refused^).
echo         Done. Every phone turns push on once, from the bell in the app.
exit /b 0

:asksecret
REM  %1 = the secret name. Runs INSIDE worker\, so it lands on the engine.
echo.
echo         %~1 is NOT set on azoneofficial-api.
echo         Paste the value from the Meta app dashboard
echo         ^(Use cases - Threads API - Settings^) and press Enter.
echo         Nothing is shown while you paste. Press Enter alone
echo         to skip for now - the Threads tab will keep saying so.
call npx wrangler secret put %~1
if errorlevel 1 (
  echo         %~1 was NOT saved ^(skipped or refused^).
) else (
  echo         %~1 saved on azoneofficial-api.
)
exit /b 0

:deployretry
REM  v1.90.1 - a lost connection mid-upload ("fetch failed", 04-09) is not
REM  a code error. Three attempts, fifteen seconds apart, before giving up.
set "TRY=0"
:deployagain
set /a TRY+=1
call npx wrangler deploy
if not errorlevel 1 exit /b 0
if %TRY% GEQ 3 exit /b 1
echo         upload failed ^(attempt %TRY% of 3^) - waiting 15 seconds, then again...
timeout /t 15 /nobreak >nul
goto :deployagain

:nologin
cd /d "%~dp0"
echo.
echo   [X] Not signed in to Cloudflare. Nothing was deployed.
echo       Fix it once - a browser window opens:
echo         cd worker
echo         npx wrangler login
echo       Then double-click this file again.
echo.
pause
exit /b 1

:nofolders
echo.
echo   [X] Could not find both project folders side by side.
echo       Expected them next to each other, for example:
echo         Desktop\elfiaofficialstore
echo         Desktop\a2zcreative-official
echo       Send this message over.
echo.
pause
exit /b 1

:nobuild
echo.
echo   [X] The build produced no out\index.html, so there is no
echo       website to publish. Nothing further was deployed.
echo       Send the lines above over.
echo.
pause
exit /b 1

:sitefailed
echo.
echo   ============================================
echo    [X] THE WEBSITE STEP WAS REFUSED.
echo   ============================================
echo    The engine above is already live, but the pages people
echo    actually look at were NOT updated - which is exactly the
echo    half-deployed state this file exists to prevent.
echo.
echo    The usual cause: that worker is connected to a GitHub
echo    repository, and Cloudflare will not let this computer
echo    publish over a git-connected worker. Fix it once:
echo      Cloudflare - Workers and Pages - pick the worker
echo      - Settings - Build - Disconnect
echo    then run this file again.
echo.
echo    Copy this window and send it over.
echo.
pause
exit /b 1

:storeguardsfailed
cd /d "%STORE%"
echo.
echo   ============================================
echo    [X] A STORE RULE THAT PROTECTS LIVE DATA IS BROKEN.
echo   ============================================
echo    The store was NOT published. The failing guard is named above.
echo    Anything the portal published before this is already live.
echo.
pause
exit /b 1

:guardsfailed
echo.
echo   ============================================
echo    [X] A RULE THAT PROTECTS LIVE DATA IS BROKEN.
echo   ============================================
echo    Nothing was deployed and the database was not touched.
echo    The failing guard is named above with what it protects.
echo    Fix that, then run this file again.
echo.
pause
exit /b 1

:failedpop
cd ..
set CI=
:failed
echo.
echo   ============================================
echo    [X] A STEP FAILED - nothing after it ran.
echo   ============================================
echo    Scroll up to the last error and send it over.
echo.
pause
exit /b 1
