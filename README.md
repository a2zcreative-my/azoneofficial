# A2Z / AZ ONE Business Platform

Public website, staff portal, admin tools, and business operations for A2Z CREATIVE MARKETING and AZ ONE OFFICIAL. The repository includes HR, payroll, sales documents, inventory, reconciliation, and integrations. ELFIA is a client, not a house brand.

Repository rechecked on **12 October 2026** after the user's changes: local/GitHub main is **3e42644**, package version **1.181.9**, and public API health/login report **1.181.9**. The backup/browser infrastructure is committed. The first Linux browser result is still pending; see [docs/PROJECT-STATE.md](docs/PROJECT-STATE.md).
The Hankeis/Telegram server and portal work passed the release gates; the external Telegram adapter remains separate work. See [docs/PROJECT-STATE.md](docs/PROJECT-STATE.md) before editing or deploying.

Every contributor, human or AI, starts with [AGENTS.md](AGENTS.md) (the one contract for every AI tool), then [CLAUDE.md](CLAUDE.md), [docs/PROJECT-STATE.md](docs/PROJECT-STATE.md), and the latest [CHANGELOG.md](CHANGELOG.md) entry before implementation. `PUSH.bat` now refuses dirty worktrees by default so one contributor cannot silently clean, commit, or deploy another contributor's changes.

## ERP programme - 20 October 2026

The portal is being completed into joined HRM, CRM, inventory, sales and finance systems without
changing what staff already rely on. Five phases are built locally (1.181.13 to 1.181.17, migrations
0140 to 0144): customer history and part payments; receive stock and reorder levels; month end,
position, audit trail and stock take; the client file, follow-ups, monthly invoices and acceptance on
the shared link; joining and leaving, probation, HR letters, training, the team leave calendar and a
quotation approval limit that is off by default. Status and routes:
[docs/ERP-ROADMAP.md](docs/ERP-ROADMAP.md). Nothing is live until `PUSH.bat` runs.

## Current Plan

Read the [12 October improvement plan](docs/IMPROVEMENT-PLAN-2026-10-12.md) for the latest review, priorities, acceptance criteria and Claude handoff. Implementation has begun with release verification, backup completeness checks, a recovery manifest and an isolated synthetic restore drill. Remaining phases are pending; see the current handoff for evidence and limitations. The earlier plans below remain background for their respective programmes.

Start with [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md#current-erp-plan---17-september-2026)
for the ERP review, phased implementation, two-company requirements, verified
e-signatures, acceptance tests, and decisions. [ROADMAP.md](ROADMAP.md) summarizes
the sequence. Proposed work is distinguished from existing functionality.

[Attendance and ERP follow-through](docs/SHIFT-AND-ERP-IMPLEMENTATION.md) records the
confirmed half-day and legacy-ownership decisions, local changes, tests, and remaining
company-isolation/e-signature work.

[Company reconciliation workspace](docs/COMPANY-REVIEW-IMPLEMENTATION.md) describes the
new management queue and staff company setup. Ownership proposals and planned access
do not yet restrict company data or change live balances.

The current code already contains shared card variants, SVG navigation, One Desk,
and a company/version signature vault. The next signing improvement is explicit
approval evidence tied to a document revision and verified signer.

## Stack

Next.js 16 static export (Turbopack) · React 19 · TypeScript · plain CSS (the in-house Portal Interface System V3: `styles/erp-v3.css` + CSS Modules, no Tailwind since v1.172.2) · Framer Motion · Lucide · React Hook Form · Zod. A separate Cloudflare Worker provides the API with D1 and R2 storage.

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
- `pnpm test:browser` — Linux WebKitGTK matrix; see [browser checks](tests/browser/README.md). Invoked by the new Linux GitHub workflow; not part of local `pnpm ci`. Remote validation is pending.
- `pnpm guard` — repository checks listed in `scripts/run-guards.mjs`
- `pnpm ci` — typecheck, lint, guards, and production build
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
| AGENTS.md | The one contract for every AI tool (Codex, Copilot, Cursor, Gemini CLI, Claude) |
| CLAUDE.md | Full implementation contract and the house rules learned in production |
| GEMINI.md, .github/copilot-instructions.md | Tool pointers to AGENTS.md |
| docs/PROJECT-STATE.md | Current local and production state, blockers and handoff |
| CHANGELOG.md | Version history, written for the owner |
| docs/ERP-ROADMAP.md | The ERP programme: rule, decisions, phases, routes, tables |
| docs/DATABASE.md | Migration notes; the migration files are the evidence |
| docs/PERMISSIONS.md | Roles and permissions |
| docs/INTERFACE-SYSTEM-V3.md | How UI is built now (no Tailwind) |
| docs/DESIGN-TOKENS-V2.md | Design tokens |
| docs/IMPROVEMENT-PLAN-2026-10-12.md | The 12 October review and its priorities |
| docs/BACKUP-RECOVERY.md | Backup and restore |
| docs/P1-ARCHITECTURE.md, docs/V2-MIGRATION.md | Routing and V2 background (P1.0b / P1.2+ not authorised) |
| DEPLOYMENT.md, AUTO-DEPLOY.md | Build, deploy, rollback |
| CONTRIBUTING.md | Branches, commits, standards, test inventory |
| tests/browser/README.md | Browser checks and fixtures |

## Documentation Status
Root `IMPLEMENTATION-PLAN.md` owns current improvement planning. `CHANGELOG.md`
records releases; `package.json` owns the package version. Older guides, including
`WORKFLOW.md` and copies under `docs/`, have not all been revalidated against the
current release. Check their date/version before treating them as operating instructions.
For implementation changes, update the affected workflow guide and acceptance
evidence alongside the code. Documentation-only planning does not mark a feature shipped.
