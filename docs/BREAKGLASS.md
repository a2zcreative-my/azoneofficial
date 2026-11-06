# Level 2 break-glass - DRAFT, NOT APPROVED FOR USE

Secure Authentication 2.0, Phase R (claude/PHASE-R-GOVERNANCE.md revision 2, sec. D). This procedure exists for ONE situation: the company owner (CEO) or the Super Admin is locked out AND the in-app executive recovery cannot run (the panel - COO and CCO - is unavailable or compromised), or the 12-hour wait would cause serious harm. It needs its own written approval by the CEO before it may ever be used. Until then it is a draft.

## Who

- The **Cloudflare account owner** (the person who holds the Cloudflare account for A2Z OS) and **one witness**, both physically present.
- The Cloudflare account is protected by a **hardware security key**; its recovery codes are in a **sealed, tamper-evident envelope** held by two people. No shared database password exists; the database is reached only through the Cloudflare account.

## What it may do

Only, for ONE account (the CEO or the Super Admin): turn off two-factor, remove its passkeys (kept as history), delete its backup codes and pending 2FA challenges, end every session, void outstanding set-password and Google requests, mark forced rotation, and write an `auth.breakglass` audit row naming both people. It never changes a role, an email, the owner designation, a permission, payroll, finance or any other account.

## Steps

1. Write down, on paper, date, time, both full names, the account id, and why the in-app recovery cannot be used.
2. Check the script: `scripts/breakglass/reset-account.sql`. Its SHA-256 must be exactly
   `b3dc6a9f47b28bc3e388e4c594701ac72a05726ca5e7f9fd37251a8c5aba9924`
   (PowerShell: `Get-FileHash scripts\breakglass\reset-account.sql -Algorithm SHA256`). If it differs, STOP.
3. Copy it to a temporary file; replace every `__TARGET_ID__` with the account id and `__WITNESSED_BY__` with both full names. Read the copy aloud; the witness checks it.
4. In `worker/`: `npx wrangler d1 execute azoneofficial --remote --file <the copy>`.
5. The person signs in with their password and sets up two-factor again (the mandatory gate asks), then reviews their recent activity in Profile -> Security.
6. Delete the temporary copy.

## Within 24 hours

- Rotate the Cloudflare API tokens used; re-seal the envelope with fresh recovery codes.
- Review the audit history around the event (both names, the account, what followed).
- Write a short incident note to the project (claude/INCIDENT-<date>-BREAKGLASS.md).

## If the password is also lost

This script does not set a password. With email sending set up, the owner or the Super Admin (whichever is not the locked-out account) issues a set-password link from the account sheet afterwards; without it, the link is shown once to hand over in person.
