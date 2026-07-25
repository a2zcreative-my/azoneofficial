# FEATURE-SUGGESTIONS.md — Features You Might Be Missing

**Date:** 25 Jul 2026 · Complements ROADMAP.md (payroll, inventory, client portal, mobile app already planned there)

Ordered by how directly each one serves the actual business — a live commerce agency in Malaysia that also sells its own brand (ELFIA).

---

## A. Core business (the biggest gap)

### 1. Live Session module 🎯
The portal manages HR and sales documents, but not the thing the company actually does. A Live Session module would tie everything together:
- **Schedule**: date/time, platform (TikTok/Shopee/FB), client brand, assigned host + live manager
- **Rundown checklist**: pinned deals, offer sequence, talking points (currently living in WhatsApp/Sheets)
- **Post-live report**: viewers, GMV, orders, top products — the "You watch the numbers" promise on the website, systemised
- Later: client-visible session reports become the backbone of the planned Client Portal

### 2. Host commission tracking
Live hosts are typically paid base + commission on session GMV. Once sessions are recorded (item 1), commission per host per session is a small step — and it feeds the planned Payroll module with real data.

### 3. ELFIA live-stock tracking
Lightweight stock for live sessions: units brought to a session, units sold, balance. Not full inventory — just enough to stop overselling on stream. Grows into the ROADMAP Inventory module.

## B. Malaysian compliance (time-sensitive)

### 4. LHDN MyInvois e-Invoice readiness ⚠️
Malaysia's mandatory e-invoicing is rolling out to all businesses in phases. Before building full API integration, prepare the data model now: invoice fields for TIN, business registration number, SST number, buyer details, and unique immutable document numbers (the v1.2.7 numbering already complies). Verify AZ One's current onboarding deadline with your accountant — building INV/CN around MyInvois fields now avoids a painful retrofit.

### 5. SST fields on QT/INV
If/when AZ One passes the SST registration threshold for taxable services: tax rate, tax amount, and SST number lines on documents. Cheap to add now as optional fields.

### 6. Malaysian public holiday calendar for leave
Leave balances currently count calendar days. A holiday table (national + Johor state holidays) makes leave day-counting correct and enables "upcoming holiday" cards on the portal dashboard.

## C. Money flow (completes the sales chain)

### 7. Payment recording + Official Receipt (OR)
INV exists, but nothing records that it was paid. Add: payment entries (date, method, amount, partial payments allowed), auto OR number (`OR20260725-01-AZOO`), and an outstanding/aging view. This is what turns the Sales module into something Finance actually lives in.

### 8. Credit Note (CN)
Needed for returns and corrections — and required for e-Invoice compliance (you can't delete an issued invoice; you offset it).

### 9. Customer statement of account
One page per customer: all INVs, payments, balance. Exportable as PDF once QT/INV PDF ships.

## D. Communication & operations

### 10. WhatsApp notifications for enquiries
A new website enquiry currently waits until someone checks /admin. A Cloudflare Worker → WhatsApp Cloud API (or even email-to-phone) ping to the BD role means enquiries get answered in minutes — which is the conversion window.

### 11. Quotation validity + idle nudges
Auto "valid for 30 days" on QT, auto-expire state, and the dashboard "quotations idle > 7 days" list from REVIEW.md.

### 12. Announcement read receipts
"Seen by 4/7" — small, but gives MD/COO real signal.

## E. Platform hardening

### 13. Scheduled D1 backup
A cron-triggered Worker exporting D1 to R2 (daily, keep 30). One bad migration without this loses the company's HR and sales history. **Recommend doing this before any of the above.**

### 14. 2FA for super admin / admin accounts
TOTP on top of the existing auth. The CMS and staff data are worth a second factor.

### 15. Audit log viewer
Audit logging exists (SECURITY.md) — surface it read-only in /admin for super admins so it's actually usable during an incident.

---

## Suggested sequencing
1. **#13 D1 backup** (safety net first, ~half a day)
2. **#7 Payments + OR** and **#8 CN** (completes money flow; pairs with the planned QT/INV PDF work)
3. **#1 Live Session module** (the differentiator — start minimal: schedule + post-live report)
4. **#4 e-Invoice field readiness** (confirm deadline with accountant)
5. **#10 WhatsApp enquiry alerts**
6. Everything else as capacity allows

---

## History (do not remove)
| Version | Date | Change |
|---|---|---|
| v1.2.7 | 25 Jul 2026 | Initial suggestions list created (15 items, A–E categories). |
