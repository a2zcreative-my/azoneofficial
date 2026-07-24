# AZ ONE OFFICIAL — Corporate Website

Premium corporate landing page for AZ ONE OFFICIAL, a Malaysian live commerce agency, featuring the ELFIA fashion brand.

## Stack

Next.js 15 · React 19 · TypeScript (strict) · Tailwind CSS v4 · Framer Motion · shadcn/ui · Lucide · React Hook Form · Zod

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

## Scripts

- `pnpm dev` — local development
- `pnpm build` — production build
- `pnpm lint` — ESLint
- `pnpm typecheck` — TypeScript check (no emit)
- `pnpm format` — Prettier

## Structure

```
app/          App Router pages, layout, metadata
components/
  home/       Landing page sections
  layout/     Navbar, footer, shared shells
  ui/         shadcn/ui primitives
hooks/        Reusable hooks
lib/          Utilities
types/        Shared TypeScript types
constants/    Site config, nav, content data
styles/       Global CSS + design tokens
public/       Static assets
```

## Documentation

| File | Purpose |
|---|---|
| CHANGELOG.md | Version history |
| FEATURES.md | Implemented functionality |
| ROADMAP.md | Planned work & pre-launch checklist |
| ARCHITECTURE.md | System design + Phase 3 decision |
| DATABASE.md | D1 schema design (Phase 3) |
| API.md | API design (Phase 3) |
| DEPLOYMENT.md | Build, deploy, rollback |
| SECURITY.md | Security posture & Phase 3 requirements |
| CONTRIBUTING.md | Branches, commits, PRs, standards |
| ADMIN_GUIDE.md | Admin CMS design & permissions |
| USER_GUIDE.md | How to use & edit the site today |

## Status
Phases 1–2 complete (full public site, static export). Phase 3 (admin CMS on Workers + D1 + R2) pending architecture decision — see ARCHITECTURE.md.
