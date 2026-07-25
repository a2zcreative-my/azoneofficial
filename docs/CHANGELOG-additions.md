# CHANGELOG (paste these entries at the TOP of the repo's CHANGELOG.md — keep all existing entries below them)

## [1.2.7] — 2026-07-25

### Changed
- **Sales document numbering**: new format `{TYPE}{YYYYMMDD}-{NN}-AZOO` (e.g. `DO20260725-01-AZOO`) — date-readable, daily 2-digit sequence, issuer code. Legacy numbers (`QT202600001`) remain valid and are never renumbered. Full spec + rationale: `docs/DOCUMENT-NUMBERING.md`.

### Added
- `worker/lib/numbering.ts` — atomic D1-backed number generator (KL timezone, auto-widens past 99/day) + parser accepting both legacy and new formats.
- D1 migration: `doc_counters` table keyed by `(doc_type, day)`.
- `docs/FEATURE-SUGGESTIONS.md` — 15 candidate features (Live Session module, host commission, ELFIA live-stock, MyInvois e-Invoice readiness, SST fields, MY holiday calendar, payments + OR, CN, customer statements, WhatsApp enquiry alerts, QT validity/nudges, read receipts, scheduled D1 backup, 2FA, audit viewer) with sequencing.

### Policy
- Documentation is **append-only for history**: every doc carries a History table; version entries are never removed.

---

## [1.2.6] — 2026-07-25

### Changed
- **ELFIA gallery**: replaced grid gallery with coverflow-style carousel (`components/ElfiaGallery.tsx`) — centre card prominent, side cards peek behind at reduced scale, circular prev/next controls + position dots below. Touch-swipe on mobile, keyboard arrows, `aria-live` announcements, `motion-reduce` respected. No external carousel dependency (static-export safe).
- **Service icons**: all six service cards now use a single professional icon family (`components/ServiceIcons.tsx`) — 24px grid, 1.6px stroke, rounded caps, navy chip with gold stroke. Removes the mixed generic/beige icon chips.
- **Buttons**: introduced shared `components/Button.tsx` as the single source of button sizing — h-12, rounded-full, `min-w-[180px]` on ≥sm, full-width in stacked mobile groups, two variants (primary navy / outline). Migrated CTAs on Home, Services, ELFIA, and Contact.

### Added
- `docs/REVIEW.md` — improvement suggestions covering the client site, staff portal (/portal), and customer area (/account), with a suggested priority order.

### Notes
- No API/Worker or database changes in 1.2.6. Deploy = Pages push only. (1.2.7 adds one D1 migration.)
- Deployment of v1.2.5 remains the launch blocker (see azone-website-tasks.md "Deploy checklist").

---

*(existing repo entries for v1.2.5 and earlier remain below — do not delete)*
