# UI/UX Proposal — v1.10.0 "Mobile App Shell"

**For:** Alīf (CEO), AZ ONE OFFICIAL · **Date:** 2026-08-14 · **Status:** PROPOSAL — no code changed yet
**Scope agreed:** phones only (below the `md` breakpoint). The desktop keeps the v1.8.0 sidebar shell untouched.

---

## What the reference design is, in one look

The screen you sent is your own portal — same five bottom tabs (Dashboard · Overview · News · HR · More), same attendance caption ("Today: clock in 09:39"), same Pending leave and tasks cards, and MIHAS at MITEC is a real entry in your Upcoming events. That means this is not a rebuild: it is a restyle of components that already exist, plus one new card. Every piece maps to a file we already maintain, and **zero Worker/API changes** are needed — no migration, no secrets, nothing to apply on the database. Everything from v1.9.x (geofence punching, clock-out banner, OT buttons, EN/BM, plum theme, dark mode) carries through unchanged.

What gives the mockup its "real app" feel is five things: a calm header with the person's face and a screen title instead of a toolbar; one navy hero card with a gold eyebrow announcing the next thing that matters; punchy full-width action buttons under an "On shift" heading; generously rounded, quiet cards; and a bottom bar where the active tab sits in a filled navy square with its icon. Each is a section below.

---

## 1 · Header — from toolbar to app bar

**Today:** on phones the header shows your avatar, the tab name, and up to seven icon buttons in a row (search, sound, push, bell, EN/BM, dark mode, Sign out). It works, but it reads as a toolbar, not an app.

**Proposed:** avatar (gold ring, as now) + a bigger screen title — **"Today"** on the Dashboard (BM: *"Hari ini"*), the tab name elsewhere — then exactly four controls, styled as the mockup's soft-bordered rounded squares: **🔎 search, 🔔 bell (unread badge kept), 🌙/☀️ dark mode, and the Sign out pill**. The four displaced controls (notification sound, push alerts, EN/BM, 🎨 theme preset) move into the **More sheet** as a one-row "Preferences" strip — they are set-once switches, not daily taps, and the More sheet already exists for overflow. Desktop header: untouched.

*Files: `app/portal/page.tsx` (header block ~line 4636), `lib/i18n.ts` (one new string).*

## 2 · NEXT EVENT hero card — new, the centrepiece

A navy rounded card at the top of the mobile Dashboard, exactly as in your screenshot: small gold letter-spaced eyebrow **NEXT EVENT**, the event title big and white, then date and 📍 location, with the soft decorative circle in the corner. It reads from the events API the Dashboard already has (`/staff/events` — title, `event_date`, `location` all exist), picking the first event on/after today. Tapping it jumps to the Overview calendar with that event in view. If no company event is upcoming, the card falls back to the next birthday or Johor public holiday from the same calendar feeds; if there is truly nothing, it hides rather than showing an empty box. Built entirely from theme tokens (`--primary`, `--gold`), so dark mode and the Plum preset restyle it automatically. Mobile only (`md:hidden`) per the agreed scope — the desktop dashboard already opens with the trading pulse strip.

*Files: new `components/portal/next-event-card.tsx`, mounted in the Dashboard in `app/portal/page.tsx`.*

## 3 · "On shift" card — your Quick actions, dressed like the mockup

Same buttons, same logic, new presentation. The heading becomes **"On shift"** once you're clocked in (BM: *"Sedang bertugas"*), staying "Quick actions" before that. The 2×2 phone grid is kept but the buttons grow to the mockup's height (h-12, rounded-xl, semibold) with the primary action filled navy and the rest outlined. Everything wired underneath is preserved exactly: the v1.9.1 geofence flow and its 📍 hint line, the 18:30 clock-out banner, OT in/out with the HOD warning, and the "Today: clock in 09:39" caption (which the mockup kept too, because it's good).

*Files: `app/portal/page.tsx` (Dashboard quick-actions block ~line 300). No logic edits — class and heading changes only.*

## 4 · Card language — quiet, round, roomy (phones only)

The mockup's cards are `rounded-2xl` with a touch more breathing room and bold navy section titles. Our shared `card` token is `rounded-lg`. One token edit — `rounded-2xl md:rounded-lg` — restyles every mobile card in the portal at once while leaving the desktop pixel-identical, which is the whole point of having the token. Section headings on mobile go from `text-sm` to `text-[15px]` semibold. Pending leave and My open tasks then match your screenshot with no further work.

*Files: `lib/ui-styles.ts` (one line), minor heading classes in `app/portal/page.tsx`.*

## 5 · Bottom navigation — the filled-square active tab

**Today:** text labels with a thin gold underline for the active tab.
**Proposed:** each tab gets its icon above the label — reusing the exact icon set the desktop sidebar already maps per tab, so the two navigations finally speak the same language. The active tab's icon sits inside a **filled navy rounded-xl square (white glyph)** with its label in navy underneath, precisely like the mockup; inactive tabs are muted icon + label. "More" keeps its position and behaviour, safe-area padding stays. The CEO tab-access controls and role gates drive the tab list exactly as now.

*Files: `app/portal/page.tsx` (bottom nav ~line 4787), icon map shared from `components/layout/sidebar-nav.tsx`.*

## 6 · More sheet — finishing the same thought

Since Preferences land here (§1) and the nav gets icons (§5), the More sheet is tidied to match: tab shortcuts as an icon grid in the new style, with the Preferences strip (sound · push · EN/BM · 🎨 theme) at the bottom. Small file, big consistency win.

---

## Phasing, effort, and risk

**Phase 1 — the shell** (header §1 + bottom nav §5 + card token §4): the highest visual impact for the least risk; purely presentational, ~half a day of careful work.
**Phase 2 — the hero** (NEXT EVENT card §2 + On shift restyle §3): one new component with a data fallback chain, plus class changes around live punch logic — done second so Phase 1's shell is already stable underneath it.
**Phase 3 — polish** (More sheet §6 + a pass on both themes, dark mode, BM strings, iPhone safe areas, and the usual adversarial review before packaging).

**Risks are small and known.** The only code near business logic is §3, and it deliberately changes classes and a heading string, not behaviour — the punch/geofence/OT paths aren't edited. The card-token change is one line but portal-wide on mobile, so Phase 3 includes a sweep of every tab at phone width. Nothing touches the Worker, so rollback is "redeploy the previous site build".

**On your approval** I'll build all three phases as **v1.10.0**, run the offline typechecks and the adversarial review as usual, and deliver the zip with the changelog. Deploy will be site-only: `pnpm build` and publish — no migration, no secrets, worker untouched.
