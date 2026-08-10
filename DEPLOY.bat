@echo off
REM ============================================================
REM  AZ ONE OFFICIAL - ONE-CLICK DEPLOY (v1.4.279)
REM  Put this file INSIDE the azoneofficial-main folder and
REM  double-click it. It always runs from its own folder, so the
REM  "wrong directory" problem cannot happen.
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

echo ============================================
echo  AZ ONE OFFICIAL - one-click deploy
echo  Folder: %CD%
echo ============================================
echo.

if not exist node_modules (
  echo [1/4] Installing packages ^(first run only, a few minutes^)...
  call pnpm install
  if errorlevel 1 goto :fail
) else (
  echo [1/4] Packages already installed - skipping.
)

echo.
echo [2/4] Applying database migrations ^(0060 - 0067^)...
set CI=true
call npx wrangler d1 migrations apply azoneofficial --remote
if errorlevel 1 goto :fail
set CI=

echo.
echo [3/4] Deploying the server ^(worker^)...
cd worker
call npx wrangler deploy
if errorlevel 1 (
  cd ..
  goto :fail
)
cd ..

echo.
echo [4/4] Building the website...
call pnpm build
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  DONE! Everything is deployed.
echo  Now: hard-refresh the portal ^(Ctrl+F5^).
echo  You should see:
echo   - "Overall sales" card on the Dashboard
echo   - "Sales history" on Ecommerce
echo   - "Profit ^& loss" on Expenses
echo   - "Pipeline insights" on Social
echo   - The red migration box GONE in /admin
echo ============================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================
echo  [X] A step FAILED above.
echo  Take a screenshot of THIS WINDOW and send
echo  it to Claude - the error text above tells
echo  us exactly what went wrong.
echo ============================================
echo.
pause
exit /b 1
