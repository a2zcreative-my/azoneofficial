# AZ ONE OFFICIAL — Technology & Feature Recommendations

These are suggestions for you to consider, building toward a system that can carry serious scale ("1 MILLION"). Nothing here has been changed in the code — this is a menu, roughly ordered by value-for-effort. Your stack today (Next.js 15 on Cloudflare Pages, a Cloudflare Worker API, D1 SQLite, R2 storage) is a genuinely modern, low-cost, globally-fast foundation. Most of these build on it rather than replacing it.

## Highest value, lowest effort

**Move secrets out of source for good.** Add a secret-scanning check (e.g. `gitleaks`) as a pre-commit hook and a CI step. The single most damaging finding in this audit was live credentials committed to the repo; a scanner stops it happening again automatically.

**Turn on a staging environment + one-command deploys.** Right now a wrong-order deploy has already blanked the staff directory once (your own changelog records it). A Cloudflare "preview" environment plus a `wrangler deploy` that always runs migrations first would make deploys boring and safe.

**Add an external uptime monitor.** The public `/api/v1/health` endpoint now works (it was previously shadowed and always returned 401). Point UptimeRobot or Better Stack at it — a system cannot report its own outage, so the monitor must live outside Cloudflare.

**Automated tests on the money paths.** You have no automated tests. Even a dozen tests around login, payroll totals, TikTok stock deduction and invoice numbering would catch the class of "undefined variable, whole tab 500s" bugs this audit found by hand. Vitest runs your Worker logic directly; Playwright (already available) can drive the portal.

## Security & reliability hardening (next tier)

**WebAuthn / passkeys** as a stronger, phishing-resistant alternative to TOTP for management accounts — Cloudflare and modern browsers support this natively now.

**Cloudflare Turnstile** on the public login and enquiry forms to blunt credential-stuffing and spam without a CAPTCHA that annoys real customers.

**Rate-limit and WAF rules at the edge** (Cloudflare dashboard) in front of the Worker, so abusive traffic never reaches your code or your D1 budget.

**Content-Security-Policy header.** The baseline security headers are now in place; a CSP is the next layer and closes most remaining XSS avenues. It needs a short tuning pass against your inline scripts, which is why it wasn't switched on blind in this release.

**Point-in-time backups.** Your nightly R2 dump is good; Cloudflare D1 also offers time-travel restore. Confirm it's enabled and rehearse a restore once, so a bad migration is a 10-minute recovery, not a crisis.

## Scaling toward "1 MILLION"

At high volume the main pressure points are the database, the media pipeline, and background work:

**Queues instead of cron-walks.** Today every 30 minutes the sync re-walks 30 days of TikTok orders. At scale, move order processing to **Cloudflare Queues** — the webhook drops a job, a consumer processes it once. This removes the repeated full scans (which were also the source of the error-log spam) and handles bursts gracefully.

**Watch the D1 ceiling.** D1 is excellent up to a point but is still SQLite. If order/attendance/audit volume grows into the tens of millions of rows, plan a path to a larger engine — Cloudflare's **Hyperdrive** in front of Postgres (Neon or Supabase) keeps your Worker code and its edge speed while giving you a database built for that scale. Design for it now by keeping all data access behind the Worker (which you already do).

**Media via Cloudflare Images / Stream.** For product photos and live clips at scale, Cloudflare Images (automatic resizing, format negotiation, CDN) and Stream (video) are cheaper and faster than serving raw files from R2 and will noticeably speed up the storefront on phones.

**Analytics that scale.** For dashboards over millions of rows, feed events into **Cloudflare Analytics Engine** or a columnar store rather than counting rows in D1 on every dashboard load.

**Observability.** Wire the Worker to structured logging + traces (Cloudflare Workers Logs, or Sentry/Baselime). When something breaks at a million requests, you want a trace, not a guess.

## New features worth considering

**Real-time notifications.** Replace the 60-second notification poll with a live push (Cloudflare Durable Objects + WebSockets, or server-sent events). The bell would update instantly and you'd cut a lot of redundant requests. Add browser/mobile **web push** so staff get an alert even with the tab closed.

**A proper sales-target and commission engine.** The new dashboard auto-computes targets from history; a natural next step is per-person and per-team targets, tiered commission rules, and a leaderboard — turning the "trading floor" view into something the whole team competes on daily.

**AI where it earns its place.** With Workers AI you could add: a customer-enquiry auto-responder/triage, a "what should I restock this week" suggestion from sales velocity, and a natural-language question box over your own sales data ("how did service revenue do vs last month?"). These run at the edge and keep data in your account.

**Customer-facing order tracking & a client portal.** You already generate quotations, invoices and delivery orders with share links; a light client login that shows a customer their orders, invoices and live-session history would reduce "where's my order" enquiries and reads as a premium touch.

**Mobile app shell (PWA).** The portal is already responsive and app-styled. Making it an installable Progressive Web App (offline shell, home-screen icon, push) gives staff an "app" without app-store overhead.

**Two-person approval on the riskiest actions.** For payroll runs and bulk price changes, an optional second-approver step adds a control that scales with headcount and protects you as the team grows.

## A note on the stack itself

You don't need to rewrite anything to grow. Next.js 15 + Cloudflare is a current, well-supported choice as of 2026. The right sequence is: lock down deploys and add tests first (so change is safe), then adopt Queues and edge analytics as volume rises, and reach for Postgres-via-Hyperdrive only when D1's limits actually bite. Adopt the AI and real-time features when they solve a real problem for the team, not before — each one is easy to bolt on later precisely because your data already lives behind one clean Worker API.
