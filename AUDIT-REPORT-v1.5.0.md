# AZ ONE OFFICIAL — Security Audit & Upgrade Report (v1.5.0)

Prepared 11 August 2026. This report covers the full security audit you asked for, the fix for "CCO can't log in after logout", the removal of the Social tab, the new trading-style dashboard, and the move to global/shared styling. Every item below was implemented and type-checked; nothing here is a proposal you still have to action, except the three operational steps in the box directly under this line.

## Do these three things before/right after deploying

1. **Rotate the TikTok app secret and the seller access token in TikTok Partner Center.** They were committed in `test_tiktok.ts` (now deleted). Anyone who ever had a copy of the repo can forge webhooks and call your shop API. Treat both values as public.
2. **Reset the passwords for `izzudin@azoneofficial.com` and `admin@azoneofficial.com`.** A committed SQL file (`worker/update-all.sql`, now deleted) had overwritten them with the known `SuperSecretPassword123` incident hash. This is the single most likely reason a management account could log in while a session lasted but never again after logout. Reset them through /admin → Users.
3. **Confirm `SESSION_PEPPER` is set** in the Worker (`wrangler secret list`). Several fixes assume it is present.

---

## 1. The "CCO cannot log in after logout" bug

This was not one bug; it was up to five overlapping ones, any of which could produce the exact symptom of "works until I sign out, then never again". All are fixed:

The committed password-reset SQL had replaced two management accounts' password hashes with an unverifiable value. Whoever still had a live 12-hour session kept working; the moment they logged out, no password could ever match again. Deleting the file does not undo the database write — that is why step 2 above (resetting those passwords) matters.

The login rate limiter counted *successful* logins against the same 10-per-15-minutes budget, keyed only by IP address. Everyone in your office shares one public IP, so ten normal sign-ins in a quarter-hour locked out the eleventh person — and it looked account-specific because whoever signed in last was the one who got locked out. Login now counts only failed attempts, keyed per account **and** IP, and clears the counter on success.

The "Two-factor required" screen's Sign-out button tried to delete the session cookie with JavaScript. That cookie is HttpOnly — JavaScript cannot touch it — so the button cleared nothing, sent the person back to /login, which saw a still-valid session and bounced them straight back to the same screen: an inescapable loop. It now performs a real server-side logout. The CCO role was also missing from the list of roles that must have 2FA, so the CCO was one of the accounts most likely to hit that dead-end; `cco` has been added.

`www.azoneofficial.com` was routed to the API but rejected every sign-in from that host as a forbidden origin, with a misleading "email or password is incorrect" message. Both apex and www are now accepted.

Finally, `/auth/me` and every other API response were cacheable. A cached "you are signed in" response could survive a logout and redirect a signed-out user back into the portal, where every call then failed — indistinguishable from "I can't log in". All API responses are now `no-store`.

## 2. Full security audit — what was found and fixed

**Critical**

Committed secrets and a committed backdoor password were removed (`test_tiktok.ts`, `test-crypto.js`, `worker/update-all.sql`, `fix_portal.js`). Database backups were publicly downloadable at a predictable URL because the media route treated everything not under `private/` as public — the whole dump (password hashes, TOTP secrets, IC numbers, bank accounts, salaries) was one guessed date away. The media route is now default-deny: only site uploads are public; backups, staff documents, payroll templates and claim receipts require authentication and an ownership check.

**High**

SVG uploads were accepted and served inline from the API origin — a stored cross-site-scripting vector that could read the CSRF cookie and drive any authenticated action. SVG is no longer an allowed upload type, and any markup-bearing file is served as a download with `nosniff`. Offboarding never actually stopped the person signing back in; a resigned or terminated status now blocks login and Google sign-in on every path (while deliberately leaving the account on its final-month payroll run so the leaver still gets paid). Logout now also clears the CSRF cookie and can revoke every device at once. Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) are attached to every response.

**Medium**

`cco` added to mandatory-2FA roles. Admin-tier accounts can now only be modified by a super admin — previously a CEO (who shares the admin rank but not admin permissions) could reset an admin's password and sign in as them. The unauthenticated TikTok webhook could grow the database indefinitely; its receipts are now rate-limited per IP and the table is trimmed. Rate limiting was made atomic (the old read-then-write pair could be raced). Token and secret comparisons are constant-time.

**The error-notification flood** ("22 new system errors since the last check…") had two causes, both fixed. The `tiktok_location` diagnostic sat above the "already imported" early-exit, so every order without a resolvable city re-logged on every 30-minute sync pass, forever — it now logs only on first import. And `logError` rewrote the whole 500-row table on every single write while keeping one row per occurrence; it now de-duplicates identical messages within a 6-hour window and trims lazily. Genuine errors will no longer be buried, and management will no longer be bell-notified about the same recurring condition every half hour.

**Low / correctness bugs found along the way**

The Expenses tab, the Fulfilment drill-down, and the payroll commission-base card each referenced a variable that did not exist in scope and would 500 on load — all fixed. The "client gone quiet" alert cron called a function it never imported, so it silently failed every run — fixed. Returned or cancelled TikTok orders could still deduct stock — fixed. Two hand-built SQL fragments were converted to bound parameters, and download filenames are sanitised.

## 3. Social tab removed

The Social tab, its three panels (prospect pipeline, trending searches, pipeline insights), the deleted `prospects-panel.tsx` component, and the Worker API routes behind them (`/staff/prospects*`, `/staff/trends/my`, `/staff/prospects/insights`) are all gone, along with the follow-up-reminder cron that pointed at the tab. Existing prospect data is left untouched in the database, so nothing is destroyed and the feature could be restored later if you ever change your mind.

## 4. Trading-style dashboard

The dashboard hero band is now a "Sales Floor" view: a live ticker showing today's sales in market green or red against yesterday, the month, all-time, and unpaid invoices; a KPI target bar with a pace marker showing where the month says you *should* be; product-versus-service market targets, each measured against its own goal; motivation that changes with your actual pace (on track, push time, comeback mode); and concrete boost suggestions drawn from your real data — your best-selling hour for scheduling the next live, unpaid invoices to chase, open quotations to follow up, and low stock to replenish.

As you asked, targets are **auto-computed from history** — each target is last month's figure plus 10%, rounded up — so the team always has a number to beat without anyone setting one. If someone does set a manual target on the Ecommerce tab, that always wins. **The calendar is completely unchanged** (verified byte-for-byte).

## 5. Global styling

You asked for CSS and styling to be global. One shared `lib/api.ts` now replaces fifteen slightly-different copies of the same request helper that had drifted apart (some attached the CSRF token, some didn't). `lib/ui-styles.ts` gained the button, label, chip and input styles that had been pasted across files, and `styles/globals.css` gained proper semantic tokens for success/warning/danger/info, one canonical gold (two different golds were shipping side by side), and market bull/bear colours. The KPI cards no longer hardcode hex values.

## Verification

The full Worker and the full front-end both type-check clean after every change. A production `next build` was not run in this environment only because the package registry is network-restricted here; run `pnpm install && pnpm build && (cd worker && npx tsc --noEmit)` on your machine or in CI to confirm before deploying. The one migration-related note: no new database migration is required — prospect tables are intentionally left in place.

## Suggested next steps (not yet implemented — for your consideration)

These are recommendations, kept separate from the work above. See `RECOMMENDATIONS-v1.5.0.md` for the fuller list, including newer technologies and new features worth considering for a "1 MILLION"-scale system.
