# Platform Review — Improvement Suggestions
**Date:** 25 Jul 2026 · applies to build v1.2.5 → targets v1.2.6+

A practical review of the three audiences the platform serves. Items marked **[quick]** fit in the current UI pass alongside the gallery/icon/button changes; the rest belong in ROADMAP.md.

---

## 1. Client-facing website (visitors & prospects)

**[quick] ELFIA gallery → coverflow carousel.** Replaces the grid with a swipeable centre-stage carousel (done in this pass — `ElfiaGallery.tsx`). Keeps the 9 product photos but gives each one a hero moment, and works one-handed on mobile.

**[quick] Service icons → one professional family.** The six cards previously used mixed-weight generic icons on beige chips. New set: single 1.6px-stroke family on navy chips with gold strokes (`ServiceIcons.tsx`) — reads as one brand, not a template.

**[quick] Consistent CTAs.** All buttons now share one component: same height, radius, and a 180px minimum width on desktop so paired CTAs ("Book a consultation" / "See our work") always align; full-width when stacked on mobile.

**Trust signals near the fold.** As a live commerce agency, proof sells: add a strip of client/brand logos or a "sessions run / GMV generated" band — but only with real numbers. The placeholder 500+/12/3x stats should be replaced or removed before launch; fake-looking stats hurt more than no stats.

**WhatsApp-first contact.** Malaysian buyers convert on WhatsApp. Add a wa.me quick-action next to the contact form (and optionally a floating button on mobile) so a prospect can reach you in one tap instead of filling a form.

**Bahasa Melayu toggle (roadmap).** Services are delivered in BM and English; the site currently speaks only English. Even a BM version of Home + Services + Contact would widen reach with local sellers.

**ELFIA pricing clarity.** "Announced live" is fine as a strategy, but pair it with a capture: "Get notified before the next live drop" (email/WhatsApp), so the page produces leads rather than dead ends.

---

## 2. Staff portal (/portal)

**[quick] Clock-in confirmation.** After clock in/out, show a clear confirmation with the captured time — staff shouldn't have to open Attendance to verify it registered.

**Leave: attach MC photo.** Already in ROADMAP, but worth prioritising — it's the single most common HR friction. Even a simple R2 image upload on the leave form closes the loop.

**Quotation → follow-up nudge.** Sales docs (QT/DO/INV) exist but nothing prompts action. A "quotations idle > 7 days" list on the dashboard turns the module from record-keeping into pipeline.

**PDF for QT/INV before Excel export.** Between the two deferred items, PDF matters more: staff currently can't send a client a formal document from the system, which pushes them back to manual templates.

**Announcements: read receipts.** For a small team, a simple "seen by 4/7" indicator tells the MD/COO whether an announcement actually landed.

---

## 3. Customer area (/account)

**Enquiry status visibility.** Customers can see enquiry history — make the workflow states from /admin (new / in progress / resolved) visible on their side too, so an enquiry never feels like it vanished.

**Order-ready structure (roadmap).** When ELFIA sells via the site or live sessions, the account area becomes the natural home for order history + delivery status. Worth designing the nav now (Profile / Enquiries / Orders) even if Orders ships later.

**Profile completeness.** Prompt for phone number (optional) at first login — for a live commerce business, WhatsApp contactability is worth more than email.

**Password recovery is the biggest gap.** Forgot-password is deferred pending an email service, but customers *will* lock themselves out. Recommend prioritising a minimal email sender (e.g. Cloudflare Email Workers or Resend free tier) for reset + verification — it also unblocks email verification for password signups.

---

## Priority order (suggested)
1. Deploy v1.2.5 (the current blocker — nothing above matters until the site is live)
2. This UI pass: gallery, icons, buttons → v1.2.6
3. WhatsApp contact action + real stats (or remove stats block)
4. Forgot-password via minimal email service
5. PDF for QT/INV
6. MC upload in leave form

---

## History (do not remove)
| Version | Date | Change |
|---|---|---|
| v1.2.6 | 25 Jul 2026 | Initial review created (client site / staff portal / customer area + priority order). |
| v1.2.7 | 25 Jul 2026 | Deep-dive items expanded into FEATURE-SUGGESTIONS.md; this doc stays as the audience-level review. |
| v1.2.8 | 25 Jul 2026 | Site went live. [quick] items status: coverflow gallery ✅ built (incl. /products via ElfiaShowcase), icon family ✅ built, consistent CTAs ✅ built — all pending merge+push. Remaining from this review: trust signals/real stats, WhatsApp contact, clock-in confirmation. |

| v1.2.18 | 26 Jul 2026 | Acted on client-facing review items: zero stats replaced with trust signals (was the top credibility issue), packages published, CTAs made action-oriented, floating WhatsApp added, cost FAQs written. Still open from the original review: real published metrics once available, Bahasa Melayu site version. |
