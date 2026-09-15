# Roadmap

## Current ERP Priorities - 15 September 2026

Planning baseline: package v1.162.1. Scope, evidence, estimates, acceptance criteria,
and open decisions live in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md#current-erp-plan---15-september-2026).
The phases below are proposed work, not shipped functionality.

1. Map current team workflows and measure bottlenecks (2-3 days).
2. Verify and complete company boundaries for A2Z and AZ ONE (3-5 days).
3. Pilot verification-backed signing on claims, extending the existing company/version vault (5-8 days).
4. Improve the existing One Desk, shared UI, feedback, and data freshness (4-6 days).
5. Close demonstrated gaps between sales, payments, purchasing, and stock (1-2 weeks).
6. Measure performance, run a team pilot, and validate recovery (3-5 days plus pilot).

The inventory sibling-card fix, SVG navigation, company-specific signature assets,
and One Desk already exist in source. Validate and extend them; do not rebuild them.
Retired Advisors and Threads automation are outside this plan.

## Historical Roadmap

The checklist below is retained for context. Its unchecked boxes are not evidence
that a feature is still missing; many describe work already implemented.

## Now (pre-launch)
- [ ] Replace sample statistics with real numbers (`constants/content.ts`)
- [ ] Confirm social handles + email (`constants/content.ts`)
- [ ] ELFIA product photos (`/public/elfia/`)
- [ ] Review starter blog posts and legal pages (lawyer pass recommended)
- [ ] Deploy Phase 1+2: build → push → Cloudflare

## Next (content)
- [ ] Real portfolio entries and first case study
- [ ] First real testimonials
- [x] ~~ELFIA individual product pages~~ — superseded v1.3.0: catalogue removed from the agency site; product pages belong to ELFIA's standalone project

## Phase 3 — Admin CMS (see ARCHITECTURE.md for the decision required first)
- [ ] Migrate deploy target from static export to Cloudflare Workers (OpenNext adapter)
- [ ] D1 database + R2 media storage (schema drafted in DATABASE.md)
- [ ] Auth + RBAC: Super Admin / Admin / Editor / Marketing
- [ ] Dashboard: leads, enquiries, products, activity
- [ ] Content management without code changes (hero, about, services, contact, footer, menus, SEO)
- [ ] Product / Portfolio / Blog / Testimonials / Media / Enquiry management
- [ ] Contact form storing enquiries in D1

## Staff Portal — Phase B
- [ ] PDF export + print layouts for QT/DO/INV (then email/WhatsApp send)
- [ ] Working-hours/overtime/late computation on attendance reports; Excel export
- [ ] Medical certificate upload wired into leave form (media API ready)
- [ ] CRM detail view: per-customer quotations/DO/invoices + communication history
- [ ] Forgot/reset password flow (needs outbound email service decision)
- [ ] Future modules (architecture ready): Payroll, Inventory, Client Portal, Mobile App

## Later
- [ ] Bahasa Melayu language toggle
- [ ] Visitor analytics dashboard
- [ ] Live session schedule ("Watch us live") section
