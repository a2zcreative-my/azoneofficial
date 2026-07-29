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
