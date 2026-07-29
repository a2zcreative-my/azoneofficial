# DEPLOYMENT.md

**Version:** v1.3.0 — two Pages projects, one Worker. Supersedes the single-site
instructions from v1.2.x (kept in History below).

---

## 0. One-time: install

```bash
pnpm install          # from the repository root — installs every workspace
```

## 1. Agency site → azoneofficial.com

Cloudflare Pages project **azoneofficial**:

| Setting | Value |
|---|---|
| Root directory | `/` (repository root) |
| Build command | `pnpm install && pnpm build:azone` |
| Build output directory | `apps/azoneofficial/out` |
| Node version | 20 |

## 2. ELFIA site → elfia.com.my

Cloudflare Pages project **elfia**:

| Setting | Value |
|---|---|
| Root directory | `/` (repository root) |
| Build command | `pnpm install && pnpm build:elfia` |
| Build output directory | `apps/elfia/out` |
| Node version | 20 |

Both build from the repository root because the apps import workspace packages
from source; building inside `apps/<app>` alone will not resolve `@azone/*`.

## 3. API Worker (shared by both sites)

```bash
cd worker
pnpm wrangler secret put SESSION_PEPPER
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
pnpm wrangler secret put SETUP_TOKEN
pnpm migrate:prod          # includes 0006_multi_tenant.sql
pnpm deploy
```

**Variables** (Workers & Pages → azoneofficial-api → Settings → Variables):

| Name | Value |
|---|---|
| `ALLOWED_ORIGIN` | `https://azoneofficial.com` (primary origin: cookies, OAuth redirect) |
| `SITE_ORIGINS` | `{"https://azoneofficial.com":"azoneofficial","https://elfia.com.my":"elfia"}` |
| `COMPANY_DOMAIN` | `azoneofficial.com` |
| `GOOGLE_CLIENT_ID` | from Google Cloud OAuth client |

**Routes** (Triggers → Routes):

- `azoneofficial.com/api/*` — zone `azoneofficial.com`
- `elfia.com.my/api/*` — zone `elfia.com.my` (only needed once ELFIA uses the CMS or its contact form)

Without a route on a domain, `/api/*` returns 404 on that domain and the site
falls back to its static content — which is by design, but means CMS edits and
form submissions will not work there.

## 4. Migration order matters

`0006_multi_tenant.sql` rewrites `site_content` to be unique on `(site, key)`
and backfills every existing row to `azoneofficial`. Run it **before** deploying
the new Worker code, which expects the `site` column:

```bash
pnpm migrate:prod && pnpm deploy
```

## 5. Verify

```bash
curl https://azoneofficial.com/api/v1/health          # {"ok":true,...}
curl "https://azoneofficial.com/api/v1/content-public?site=azoneofficial"
curl "https://azoneofficial.com/api/v1/content-public?site=elfia"
```

The last two must return different content. If they return the same rows,
migration 0006 has not been applied.

Then check by hand:

- azoneofficial.com — homepage shows the ELFIA **client success story**, `/portfolio` and `/portfolio/elfia` render, `/products` 301s to `/portfolio/elfia`.
- elfia.com.my — its own branding, footer reads only "Powered by AZ ONE OFFICIAL".

## 6. Rollback

The two sites deploy independently: roll back one Pages project without
touching the other. The Worker is shared — a rollback there affects both, so
deploy Worker changes on their own rather than alongside a site release.

---

## History (do not remove)

| Version | Deployment |
|---|---|
| v1.2.x | One Pages project building from the repository root (`next build` → `out`), one Worker on `azoneofficial.com/api/*`, migrations 0001–0005. |
| v1.3.0 | Two Pages projects (`apps/azoneofficial`, `apps/elfia`) building from the workspace root; Worker gains `SITE_ORIGINS` and migration 0006; optional route on `elfia.com.my/api/*`. |
