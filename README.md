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
