# AZ ONE OFFICIAL — v1.7.0 new modules

Four modules from your system spec, plus the dashboard tiles. One setup step, then it's live.

## Setup — apply the migration

`cd worker && npx wrangler d1 migrations apply azoneofficial --remote`

This adds migration 0069 (the new tables). The Sales Pipeline also relies on the existing prospects tables (0066/0067), which your database already has.

## 1. Sales Pipeline (Pipeline tab)

The lead pipeline you asked for — **Lead → Contacted → Meeting → Proposal → Negotiation → Won/Lost**. Any staff member logs a lead in seconds (brand, source, niche, who referred it, contact); the sales tier moves it along the stages. Each lead has an owner and a follow-up date, and the owner is reminded — in-app and by push — on the day it's due. From Meeting/Proposal/Negotiation there's a one-tap "Prepare quotation" that jumps to the Sales tab with the lead pre-filled. Your old prospect records come straight back into this tab (their old stage names are mapped automatically).

## 2. Content management (Content tab)

Plan your live-commerce content and move each piece through **IDEA → SCRIPT → SHOOT → EDIT → APPROVAL → POSTED**. Each item holds its type (video/reel/live/campaign), platform, scheduled date, script, caption and campaign tag, and can be assigned to someone (they're notified). After posting, log the performance (views/GMV/conversion) right on the card. Filter by stage with the chip strip.

## 3. Stokis management (Stokis tab)

Your reseller network in one place. Register a stokis (contact, location, commission %), then record each purchase they make. The panel rolls up, per stokis: total purchased, outstanding balance (unpaid purchases), this month's sales against a monthly target you set, and the commission their rate would pay this month. Toggle any purchase paid/unpaid, and mark a stokis active/inactive. The tab and its data are limited to the sales/management tier.

## 4. Receipts, Credit Notes & Outstanding report (Sales tab → Documents)

Your Quotation → Invoice → Payment flow now finishes properly:

Issue a numbered **Receipt** for any paid invoice (idempotent — one per invoice), raise a **Credit Note** against an invoice (amount + reason), and see a single **Outstanding-payments report** listing every unpaid invoice with due dates and a running total. Receipts and credit notes **print with the AZ ONE OFFICIAL letterhead** (legal name, address, logo) and their own numbering (RC-… / CN-…) — use the browser's "Save as PDF" in the print dialog to send one to a client.

## 5. Dashboard company pulse

A compact strip of live counters sits below the top cards on the dashboard: **clients, active stokis, lives today, staff clocked in today, unpaid invoices, and this month's cash flow** (invoices paid minus expenses, in green or red).

## Where the rest of your spec already lives

Most of your 15-module spec was already built. As a reference: the dashboard sales/KPI/profit, CRM/clients, Live Commerce (calendar, GMV, economics), ELFIA products, Inventory, Finance (income/expenses/P&L/receivables), Team/HR (attendance, leave, payroll, KPI), Tasks, the Document numbering with your logo, and full Roles & Permissions with per-tab access control are all in place from earlier releases. This release filled the genuine gaps.

## Verifying before deploy

Both the Worker and the front-end type-check clean. A full `pnpm build` couldn't run in the environment this was prepared in (restricted package registry) — run `pnpm install && pnpm build && (cd worker && npx tsc --noEmit)` on your machine or CI, then deploy the Worker (`cd worker && wrangler deploy`) and the site, and apply the migration above.
