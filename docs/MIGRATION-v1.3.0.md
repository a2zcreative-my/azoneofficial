# MIGRATION-v1.3.0.md — single app → multi-client workspace

This release restructures the repository. Read this before pulling.

## 1. What moved

| v1.2.x | v1.3.0 |
|---|---|
| `/app`, `/components`, `/constants`, `/styles`, `/public` | `apps/azoneofficial/…` |
| `components/ui/button.tsx` etc. | `packages/ui/src/` → `@azone/ui` |
| `components/live/editable.tsx` | `packages/cms/src/` → `@azone/cms` |
| `components/contact/contact-form.tsx` | `packages/forms/src/` → `@azone/forms` |
| SEO metadata written inline in `app/layout.tsx` | `@azone/seo` builders |
| `/worker` | unchanged location, now multi-tenant |
| `*.md` at root | `docs/` (except README, CHANGELOG, MILESTONES) |

## 2. Breaking changes

**Component APIs changed** where they were coupled to the app:

| Component | Before | After |
|---|---|---|
| `PageShell` | rendered `<Navbar/>` and `<Footer/>` | renders `<main>` only; pages compose their own chrome |
| `FaqList` | imported `FAQS` | takes `items` |
| `WhatsAppFab` | imported `whatsappUrl()` | takes `href` |
| `ElfiaGallery` | took `products` | now `CoverflowGallery`, takes generic `items` |
| `PackagesCarousel` | took `packages` | now `ScrollCarousel`, takes `children` |
| `ContactForm` | posted untagged | takes `site`, tags submissions |

**Routes removed** from the agency site: `/products`, `/products/[slug]`.
`public/_redirects` 301s them to `/portfolio/elfia`, so indexed links and any
shared URLs keep working.

**Database**: migration `0006` rebuilds `site_content` with a `(site, key)`
unique constraint. Existing rows backfill to `azoneofficial` — no content is
lost, and the agency site behaves identically.

## 3. Upgrade steps

```bash
git checkout -b refactor/multi-client
# extract this build over the repository
pnpm install
pnpm typecheck && pnpm build      # verify locally — this was NOT built in the authoring environment

cd worker
pnpm migrate:prod                 # 0006 must run before the new Worker deploys
pnpm deploy
```

Then in Cloudflare:

1. Point the existing Pages project at build command `pnpm install && pnpm build:azone`, output `apps/azoneofficial/out`.
2. Create a second Pages project for ELFIA: `pnpm install && pnpm build:elfia`, output `apps/elfia/out`.
3. Add the `SITE_ORIGINS` variable to the Worker.

## 4. What to check after deploying

- `/products` 301s to `/portfolio/elfia`
- `/portfolio` and `/portfolio/elfia` render
- Homepage shows the client success story, not a product section
- `content-public?site=azoneofficial` and `?site=elfia` return different content
- ELFIA site renders in its own palette with the "Powered by AZ ONE OFFICIAL" footer

## 5. Known gaps

- The package specifics in `PACKAGES` / `PACKAGE_MATRIX` are still drafts pending confirmation against the real package sheet.
- ELFIA's OG image is currently the AZ ONE artwork as a placeholder; replace `apps/elfia/public/og.png` with ELFIA artwork before launching that domain.
- `LIVE_SESSIONS` is intentionally empty — no invented dates. Publish the schedule from the CMS or populate the constant.
- Product `details` (fabric, dimensions, care) are intentionally empty rather than invented.
