# AZ ONE OFFICIAL — multi-client workspace

A pnpm workspace containing the AZ ONE OFFICIAL live commerce agency site, the
ELFIA brand site, the shared design system, and the API that serves them.

```
apps/azoneofficial   Live commerce agency        → azoneofficial.com
apps/elfia           ELFIA hijab brand (client)  → elfia.com.my
packages/ui          Shared components + base stylesheet
packages/cms         Tenant-scoped CMS client
packages/seo         Metadata, JSON-LD, sitemap, robots
packages/forms       Shared forms
worker               Cloudflare Worker + D1 + R2 (multi-tenant)
```

## Quick start

```bash
pnpm install
pnpm dev:azone     # http://localhost:3000
pnpm dev:elfia     # http://localhost:3001
```

Other scripts: `pnpm build`, `pnpm typecheck`, `pnpm lint`,
`pnpm worker:migrate`, `pnpm worker:deploy`.

## What this repository is

**AZ ONE OFFICIAL** is a live commerce agency. It sells seven services — TikTok
Live, Shopee Live, live commerce strategy, live hosts, live operations, creative
content, and performance marketing — and proves them through client work.

**ELFIA** is a client of the agency and its featured case study. ELFIA's own
site is an independent brand experience; the only relationship it expresses is
the "Powered by AZ ONE OFFICIAL" line in its footer.

## Working in here

- Shared behaviour goes in `packages/*`. **A package must never import from an app.**
- Client-specific copy, routes, and palettes go in `apps/<app>/`.
- Editable content, statistics, portfolio, testimonials, and enquiries live in
  D1 and are scoped by tenant key.
- Adding a client: see "Adding a client" in `docs/ARCHITECTURE.md`.

## Documentation

| Document | Covers |
|---|---|
| `docs/ARCHITECTURE.md` | Workspace shape, package boundaries, theming, multi-tenancy |
| `docs/DEPLOYMENT.md` | Pages projects, Worker variables, migration order |
| `docs/DATABASE.md` | Schema and migrations |
| `docs/API.md` | Endpoints |
| `docs/SECURITY.md` | Auth, RBAC, hardening |
| `docs/ADMIN_GUIDE.md` / `docs/USER_GUIDE.md` | Day-to-day use |
| `docs/DOCUMENT-NUMBERING.md` | QT/DO/INV numbering |
| `docs/FEATURE-SUGGESTIONS.md`, `docs/ROADMAP.md` | What is next |
| `CHANGELOG.md`, `MILESTONES.md` | History, append-only |

Documentation is **append-only for history**: every document carries a History
section and version entries are never removed.
