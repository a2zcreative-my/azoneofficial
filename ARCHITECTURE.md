# Architecture

## Current (Phase 1–2)

- **Next.js 15 (App Router), React 19, TypeScript strict, Tailwind CSS v4**
- `output: "export"` — fully static site, no server runtime
- Deployed as static assets to Cloudflare (wrangler `[assets]`), auto-deploy on push to GitHub
- All content in typed constants (`constants/site.ts`, `constants/content.ts`, `constants/pages.ts`)
- Components: `components/layout` (Navbar, Footer, Section, PageShell), `components/home` (landing sections), `components/ui` (Reveal)

### Why static for now

Zero attack surface, free/cheap hosting, instant global edge delivery, and no infrastructure to maintain while the business validates content.

## Phase 3 target (decision required — see below)

Master prompt requires an admin CMS with Cloudflare Workers + D1 + R2. A static export cannot serve authenticated, dynamic admin routes.

**Recommended architecture:**

- Migrate the Next.js app to run on **Cloudflare Workers via the OpenNext Cloudflare adapter** (or split: keep public site static + a separate Worker at `/api/*` and `admin.azoneofficial.com` — simpler blast radius, recommended starting point)
- **D1** for structured data (see DATABASE.md), **R2** for media, Workers for the API layer
- Admin panel as a route group (`/admin`) behind session auth (HTTP-only secure cookies), RBAC enforced server-side per DATABASE.md roles
- Public pages progressively read from D1 (with static fallback to constants) so content edits need no deploy

**DECISION MADE (24 Jul 2026):** Option (b) — static public site + separate admin/API Worker. Resources provisioned: D1 `azoneofficial` (d9df2d7a-8303-4396-a4ee-a26836a4c9a8), R2 bucket `azoneofficial`. Worker scaffold lives in `/worker` with its own wrangler.toml, migrations, and API v0.

## Folder structure

See README.md. Rule: pages compose components; components read constants; no content hard-coded in components.

## Design principles (mandated)

Premium corporate: modern, minimal, elegant, professional, clean, trustworthy, mobile-first.
Avoid: gradients, flashy animation, overly rounded elements, neon colors, busy backgrounds, inconsistent spacing, clutter.
System: 8px spacing grid · max two font families (currently one: Poppins) · clear hierarchy · WCAG 2.1 AA contrast (deep gold #7D6027 for accent text on light; brand gold #C8A96A only decorative or on navy) · navy focus-visible outlines · consistent 8px radius (12px cards) · subtle shadows · reusable components · generous whitespace.
Every page answers: What is this? Why trust it? What should I do next?
If an element does not improve usability or clarity, remove it.

## Client subsystems added v1.9 → v1.26 (updated 2026-08-19)

- **i18n (`lib/i18n.ts`)** — `azone-lang` in localStorage; `tr()`/DICT for chrome, `L(en, ms)` at every display point elsewhere (v1.26.0 made the whole system bilingual — 43 files). The portal/admin/account top-level `lang` state re-renders the tree on toggle; components read `getLang()` per render. Logic strings stay English; display maps translate API values.
- **API layer (`lib/api.ts`)** — the ONLY sanctioned transport: `api()` (JSON), `makeApi()` (prefixed), `csrfFetch()` (binary/custom-header mutations). Attaches `X-CSRF-Token`, self-heals a missing csrf cookie via `/auth/me` + one retry (v1.26.2). Enforced by `tests/csrf-guard.mjs`.
- **Instant skeleton + cache (`components/portal/portal-skeleton.tsx`, `lib/cached-api.ts`)** — the pre-auth render returns a zero-JS skeleton baked into portal.html; per-account stale-while-revalidate cache (24h TTL, 120KB cap) seeds known-data flags so returning staff see last-known content instantly, money marked with `StaleHint`. Rule: data is UNKNOWN (skeleton) until proven empty — never show "None" while loading.
- **Tab memory (v1.24.0)** — sessionStorage keeps the active tab across refresh; a fresh browser session starts on Dashboard.
- **Mobile discipline** — every layout grid has `grid-cols-1` base (old iOS sizes implicit columns to max-content); `body { overflow-x: hidden; overflow-x: clip }` (iOS ignores `hidden`); bottom-nav padding `max(env(safe-area-inset-bottom), 6px)` (iOS reports 0 with the floating toolbar).

## Worker subsystems added v1.18 → v1.26

- **ERP modules (`worker/src/erp.ts`)** — orders, cash flow, reconciliation, commission, ads fund, purchasing, accounting.
- **Attribution (`worker/src/staff.ts` + `worker/src/shift-sales.ts`)** — leaderboard sales per person = paid invoices (salesperson_id) + TikTok GMV inside completed live-session windows (host) + manual walk-in sales (created_by) + all TikTok orders during a sales_marketing person's clocked-in shift (equal split across concurrent shifts; forgotten clock-outs capped at 23:59:59 MYT of their own day). `shift-sales.ts` is pure/import-free so tests run the shipped code directly.
- **Transient D1 retry (v1.25.2, broadened v1.26.2)** — GET/HEAD that die on a D1 blip ("Network connection lost", "storage operation failed/exceeded timeout … object to be reset") retry once after 120ms before logging; writes never retry.
- **Notifications** — poll endpoint + SSE stream (`/staff/notifications/stream`, 20s self-closing, 5s D1 poll, EventSource auto-reconnect).
- **CSRF self-heal (v1.26.2)** — `/auth/me` re-issues the `csrf_token` cookie when a valid session arrives without one.
