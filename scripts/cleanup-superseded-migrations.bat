@echo off
REM v1.40.1 — one-time cleanup after the audit's migration restructuring.
REM
REM The four bridge migrations drafted earlier on 22-08-2026 were REPLACED
REM by eight replay-safe files (audit finding B4) before anything was ever
REM applied to a database. Claude cannot delete files on this computer, so
REM this script removes the superseded four. Run it ONCE, from this folder,
REM BEFORE committing/pushing. tests/registry-parity.mjs fails the build
REM loudly if they are still present, so forgetting is caught — but a
REM leftover 0075_bridge_pricing.sql beside 0075_bridge_enabled.sql would
REM otherwise try to add the same column twice and wedge the deploy.
setlocal
cd /d "%~dp0.."
for %%F in (
  worker\migrations\0075_bridge_pricing.sql
  worker\migrations\0076_bridge_movements.sql
  worker\migrations\0077_web_orders.sql
  worker\migrations\0078_fix_po_direction.sql
) do (
  if exist "%%F" ( del "%%F" && echo deleted %%F ) else ( echo already gone: %%F )
)
echo.
echo Done. Now run:  node tests\registry-parity.mjs   to confirm everything agrees.

