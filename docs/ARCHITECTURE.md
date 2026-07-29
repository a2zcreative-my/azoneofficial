# ARCHITECTURE.md

**Version:** v1.3.0 (multi-client workspace) · Supersedes the single-app architecture documented for v1.2.x, which is preserved in the History section below.

---

## 1. Shape of the repository

```
azoneofficial/
├─ apps/
│  ├─ azoneofficial/     Live commerce agency site  → azoneofficial.com
│  └─ elfia/             ELFIA brand site (client)  → elfia.com.my
├─ packages/
│  ├─ ui/                Design-system components + shared base stylesheet
│  ├─ cms/               Tenant-scoped CMS client (Editable, live content, stats)
│  ├─ seo/               Metadata, JSON-LD, sitemap and robots builders
│  └─ forms/             Shared forms (contact)
├─ worker/               One Cloudflare Worker + D1 + R2, serving all tenants
├─ docs/                 This documentation set
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

Adding a client means adding `apps/<client>/` and a tenant key. No package is
forked, and no component is copied.

## 2. Why a workspace rather than separate repositories

Three properties were required at once: independent deployments, independent
branding, and shared engineering. Separate repositories give the first two and
lose the third — every accessibility fix, scroll-restoration bug, and carousel
improvement would have to be applied N times. A single app with a theme switch
gives the third and loses the first two.

A workspace gives all three: each app has its own `next.config.ts`, its own
domain, and its own build, while importing the same `@azone/*` packages from
source.

## 3. Package boundaries

| Package | Owns | Must never contain |
|---|---|---|
| `@azone/ui` | Layout and interaction primitives: Button, ButtonGroup, PageShell, Section, Reveal, FaqList, ProductGallery, CoverflowGallery, ScrollCarousel, ScrollMemory, ScrollToTop, WhatsAppFab | Client copy, brand colours, route knowledge |
| `@azone/cms` | `CmsProvider`, `Editable`, live content readers, `useStatistics` | Hard-coded tenant keys |
| `@azone/seo` | `buildMetadata`, `buildViewport`, JSON-LD, `buildSitemap`, `buildRobots` | Any one site's URLs or copy |
| `@azone/forms` | Contact form and submission handling | Site-specific endpoints |

The rule that keeps this honest: **a package may not import from an app.** Every
piece of client-specific information arrives as a prop or config object. That is
why `PageShell` no longer renders a navbar (each app composes its own chrome),
`FaqList` receives its questions, and `WhatsAppFab` receives an href.

## 4. Theming

Shared components style themselves with semantic tokens — `bg-brand`,
`text-gold`, `border-border`, `text-muted-foreground`. `packages/ui/styles/base.css`
maps those tokens to CSS custom properties but declares **no colours**. Each app
supplies the palette in its own `styles/globals.css`:

- **AZ ONE OFFICIAL** — navy `#1a2946` with gold, Poppins throughout.
- **ELFIA** — warm taupe `#3f3730` on paper `#fdfbf7`, bronze accent, Cormorant
  Garamond display over Jost body.

The same `Button` component therefore renders as a navy agency CTA on one site
and a bronze editorial CTA on the other, with no conditional logic.

## 5. Multi-tenancy in the API

One Worker serves every site. Requests are attributed to a tenant by
`resolveSite()`:

1. **`Origin` header** — authoritative, a browser cannot forge it.
2. **`?site=` parameter** — accepted only when it matches a configured tenant.
   This exists because statically exported pages issue same-origin GETs with no
   `Origin` header.
3. **`Host` header** — last resort.

`SITE_ORIGINS` (a Worker variable) maps origins to tenant keys:

```json
{ "https://azoneofficial.com": "azoneofficial", "https://elfia.com.my": "elfia" }
```

CORS echoes whichever configured origin made the request, with `Vary: Origin`.

Every tenant-owned table carries a `site` column (migration `0006`), and
`site_content` is unique on `(site, key)` rather than `key`. Existing rows were
backfilled to `azoneofficial`, so the agency site is unchanged.

## 6. Data ownership

| Concern | Owner |
|---|---|
| Agency services, packages, case studies | `apps/azoneofficial/constants` |
| ELFIA products, collections, journal, drop schedule | `apps/elfia/constants` |
| Editable copy, statistics, portfolio, testimonials, enquiries | D1 via the Worker, scoped by `site` |
| Staff portal, admin, auth | Worker (agency tenant only) |

ELFIA is a **client**. The agency app holds a `CaseStudy` record describing the
engagement; it holds no ELFIA product data. The ELFIA app holds the catalogue
and knows nothing about the agency beyond one footer link.

## 7. Statistics are CMS-owned

`useStatistics()` reads `stats.items` — a JSON array of `{value,label}` — from
the tenant's content. Values are strings, so an editor can publish `500+`, `3x`
or `RM1.2M`. When the key is empty the homepage renders qualitative trust
signals instead. The previous count-up animation was removed: it animated from
zero toward hard-coded targets, which rendered unpublished figures as
`0+ / 0 / 0x`.

## 8. Deployment topology

| Target | Build | Domain |
|---|---|---|
| Agency site | `pnpm build:azone` → `apps/azoneofficial/out` | azoneofficial.com |
| ELFIA site | `pnpm build:elfia` → `apps/elfia/out` | elfia.com.my |
| API | `pnpm worker:deploy` | `azoneofficial.com/api/*` |

Two Cloudflare Pages projects, one Worker. Deployments are independent: shipping
ELFIA cannot break the agency site. See `docs/DEPLOYMENT.md`.

## 9. Adding a client

1. `cp -r apps/elfia apps/<client>` as a starting point.
2. Replace `constants/brand.ts` and `constants/seo.ts`; set a new `CMS_SITE`.
3. Write `styles/globals.css` with the client's palette.
4. Add the origin to `SITE_ORIGINS`.
5. Create a Pages project pointing at `apps/<client>`.

No package changes, no duplication.

---

## History (do not remove)

| Version | Architecture |
|---|---|
| v1.2.x | Single Next.js app at the repository root; ELFIA was an internal brand rendered as `/products` inside the agency site; one Worker with unscoped CMS tables; components lived in `components/` with `@/` path aliases. |
| v1.3.0 | pnpm workspace with `apps/*` and `packages/*`; ELFIA extracted into an independent app and repositioned as a client case study; Worker made multi-tenant via a `site` column and origin-based resolution; statistics moved to the CMS. |
