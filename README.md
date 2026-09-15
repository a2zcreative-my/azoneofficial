# A2Z / AZ ONE Business Platform

Public website, staff portal, admin tools, and business operations for A2Z CREATIVE MARKETING and AZ ONE OFFICIAL. The repository includes HR, payroll, sales documents, inventory, reconciliation, and integrations. ELFIA is a client, not a house brand.

Documentation baseline reviewed on 15 September 2026: package version **1.162.3**.
This is a source-code baseline, not confirmation of the deployed version.

## Current Plan

Start with [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md#current-erp-plan---15-september-2026)
for the ERP review, phased implementation, two-company requirements, verified
e-signatures, acceptance tests, and decisions. [ROADMAP.md](ROADMAP.md) summarizes
the sequence. Proposed work is distinguished from existing functionality.

The current code already contains shared card variants, SVG navigation, One Desk,
and a company/version signature vault. The next signing improvement is explicit
approval evidence tied to a document revision and verified signer.

## Stack

Next.js 15 static export · React 19 · TypeScript · Tailwind CSS v4 · Framer Motion · Lucide · React Hook Form · Zod. A separate Cloudflare Worker provides the API with D1 and R2 storage.

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
- `pnpm guard` — repository checks listed in `scripts/run-guards.mjs`
- `pnpm ci` — typecheck, guards, and production build
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
worker/       API, database migrations, and backend integrations
tests/        Guards and behavior checks
scripts/      Build and release helpers
```

## Documentation

| File | Purpose |
|---|---|
| IMPLEMENTATION-PLAN.md | Current ERP scope, evidence, acceptance criteria, decisions; older tracks are labeled historical |
| docs/ERP-WORKFLOW-BASELINE.md | Phase 0 source map, company gaps, walkthrough script, and exit criteria |
| docs/UIUX-IMPLEMENTATION-PLAN.md | Modest UI/UX design rules, rollout order, and acceptance checklist |
| CHANGELOG.md | Version history (granular changes per release) |
| MILESTONES.md | Milestone log — full timeline, assets, decisions |
| FEATURES.md | Implemented functionality |
| ROADMAP.md | Current delivery sequence and historical checklist |
| ARCHITECTURE.md | Architecture reference; verify older phase descriptions against code |
| DATABASE.md | Schema reference; migration files are the implementation evidence |
| API.md | API reference; confirm routes and permissions against current handlers |
| DEPLOYMENT.md | Build, deploy, rollback |
| SECURITY.md | Security posture & Phase 3 requirements |
| CONTRIBUTING.md | Branches, commits, PRs, standards |
| ADMIN_GUIDE.md | Admin CMS design & permissions |
| USER_GUIDE.md | How to use & edit the site today |

## Documentation Status
Root `IMPLEMENTATION-PLAN.md` owns current improvement planning. `CHANGELOG.md`
records releases; `package.json` owns the package version. Older guides, including
`WORKFLOW.md` and copies under `docs/`, have not all been revalidated against the
current release. Check their date/version before treating them as operating instructions.
For implementation changes, update the affected workflow guide and acceptance
evidence alongside the code. Documentation-only planning does not mark a feature shipped.
