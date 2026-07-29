# Roadmap

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
