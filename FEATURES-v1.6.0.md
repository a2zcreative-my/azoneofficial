# AZ ONE OFFICIAL — v1.6.0 new features

Three features you selected from the recommendations, now built and type-checked. This is the short guide: what each one does, where to find it, and the one-time setup.

## Before you use it — two setup steps

1. **Apply the database migration** (adds the target/commission/push tables):
   `cd worker && npx wrangler d1 migrations apply azoneofficial --remote`
2. **Optional — turn on push to phones.** Generate keys once with `npx web-push generate-vapid-keys`, then:
   `wrangler secret put VAPID_PUBLIC_KEY` · `wrangler secret put VAPID_PRIVATE_KEY` · `wrangler secret put VAPID_SUBJECT` (a `mailto:you@azoneofficial.com`). Until you do this, push is simply off — the live in-app bell still works.

Everything else works the moment you deploy.

## 1. Sales leaderboard, targets & commission

Find it on the **Ecommerce tab**. Anyone who can see revenue sees the **leaderboard** — each person ranked by the sales attributed to them this month, with medals for the top three and your own row highlighted. "Attributed sales" means the paid invoices they closed plus the TikTok GMV that happened during their live sessions, so both the sales team and the live hosts show up fairly.

Directly below it, management (CEO, COO, CCO, admin) gets a **Targets & commission** editor:

Per-person and per-team monthly targets — type an amount and it saves. These feed the leaderboard's progress percentages and sit alongside the company target you already set on the revenue card.

Commission rules — add a rule like "1.5% base + 3% over target". Each rule pays its base percentage on all attributed sales plus the bonus percentage on the amount above the person's target. The leaderboard then shows management the commission each person would earn. You can toggle a rule on/off or remove it. If several rules apply to someone, the most generous one is used.

A note on the numbers: the commission figure on the leaderboard is a live estimate to guide you — the actual payslip commission is still entered on the Payroll tab, so nothing is paid automatically without your say-so.

## 2. Client order tracking

Your customers now get an **"Orders" tab** on their /account page showing their quotations, invoices and delivery orders, with paid/unpaid status and due dates. Tapping an invoice opens its PDF through the same secure share link the portal already generates, and their live-session history is listed too.

For privacy, order history is shown only to customers whose email is verified — i.e. those who sign in with Google. A customer on a password account sees a short note asking them to verify (or to message you on WhatsApp), because otherwise someone could register a stranger's email and read that person's invoices. This matches how the existing enquiry history is already protected.

## 3. Installable app + real-time notifications

The staff portal bell is now **real-time**. New notifications arrive within about five seconds instead of up to a minute, over a lightweight live stream that reconnects itself automatically. A slow background check stays as a safety net, so nothing is ever missed even on a network that blocks streaming.

Staff can also turn on **push alerts per device** with the 🔕 button in the header (it becomes 🔔✓ once on). After that they get notified even with the browser tab closed — an assigned task, an approval, a low-stock alert, all reach the phone. This needs the VAPID secrets from the setup step above; without them the button explains that push isn't set up yet.

The portal was already installable to the home screen; this release also makes it **work offline** (the app shell is cached) and handles tapping a push notification to jump straight to the portal.

## What you'd verify before deploying

Both the front-end and the Worker type-check clean. A full production build (`pnpm build`) couldn't run in the environment this was prepared in because the package registry was network-restricted there — run it on your machine or CI as the final gate, then deploy the Worker (`cd worker && wrangler deploy`) and the site, and apply the migration above.
