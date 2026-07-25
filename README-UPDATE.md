# azoneofficial — v1.2.6 + v1.2.7 update pack

This folder contains everything from the two update passes. Merge it over your local repo (extracted from `azoneofficial-built.zip`), then commit and push.

## Where each file goes

| File in this pack | Destination in repo | Action |
|---|---|---|
| `components/ElfiaGallery.tsx` | `components/ElfiaGallery.tsx` | Add, then use on the Products (ELFIA) pages in place of the current gallery |
| `components/ServiceIcons.tsx` | `components/ServiceIcons.tsx` | Add, then swap the six service-card icons for `<ServiceIcon name={serviceIconMap[title]} />` |
| `components/Button.tsx` | `components/Button.tsx` | Add, then replace ad-hoc CTA buttons on Home / Services / ELFIA / Contact |
| `worker/lib/numbering.ts` | `worker/lib/numbering.ts` | Add; call `nextDocNumber(db, "QT" \| "DO" \| "INV")` where sales docs are created |
| *(migration)* | `worker/migrations/00XX_doc_counters.sql` | Create with the `doc_counters` DDL from the header of `numbering.ts`, then `pnpm migrate:prod` |
| `docs/DOCUMENT-NUMBERING.md` | `docs/DOCUMENT-NUMBERING.md` | Add (new doc) |
| `docs/FEATURE-SUGGESTIONS.md` | `docs/FEATURE-SUGGESTIONS.md` | Add (new doc) |
| `docs/REVIEW.md` | `docs/REVIEW.md` | Add (new doc) |
| `docs/CHANGELOG-additions.md` | — | Paste its two entries at the **top** of the repo `CHANGELOG.md`, keep everything below |
| `docs/azone-website-tasks.md` | project status doc (repo root or docs/) | Replace — it contains all previous content plus v1.2.6/v1.2.7 sections and an append-only version history table |

## Commit

```bash
git add .
git commit -m "feat: v1.2.7 — ELFIA coverflow gallery, service icon family, Button standardisation, date-based doc numbering, docs (REVIEW, DOCUMENT-NUMBERING, FEATURE-SUGGESTIONS)"
git push origin main
```

## Docs policy (adopted v1.2.7)
All `.md` docs are **append-only for history**: every doc carries a History table at the bottom; version entries are never edited away. New changes add rows — they don't replace old ones.

## Reminder
azoneofficial.com is still serving v0.1. The deploy checklist in `azone-website-tasks.md` (push + Worker secrets + `/api/*` route + setup token) comes before any of this is visible.
