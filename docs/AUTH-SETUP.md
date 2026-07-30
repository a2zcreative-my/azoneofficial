# AUTH-SETUP.md — Google login for you and your staff

**Goal:** anyone with an `@azoneofficial.com` Google account signs in and lands
in the staff side automatically; customers with other Google emails get a
customer account. The code already does this — the 404 you saw meant the API
was never reachable on the domain. This document is the complete path from
that 404 to a working login.

---

## Why /api/v1/auth/google returned 404

The website is a static export on Cloudflare Pages: it has no `/api` paths of
its own. The API is a separate Worker, and it only answers on the domain if a
**Worker route** binds `azoneofficial.com/api/*` to it. That route was never
attached, so Cloudflare fell through to Pages, which correctly answered 404.

`worker/wrangler.toml` now declares the routes, so `wrangler deploy` attaches
them automatically:

```toml
routes = [
  { pattern = "azoneofficial.com/api/*", zone_name = "azoneofficial.com" },
  { pattern = "www.azoneofficial.com/api/*", zone_name = "azoneofficial.com" },
]
```

## Deploy checklist (run in order, inside `worker/`)

```bash
# 1. Migrations — the users/sessions tables must exist
npx wrangler d1 migrations apply azoneofficial --remote

# 2. Secrets (first deploy only)
npx wrangler secret put SESSION_PEPPER        # random 32+ chars
npx wrangler secret put GOOGLE_CLIENT_SECRET  # from Google Cloud (below)
npx wrangler secret put SETUP_TOKEN           # random 32+ chars

# 3. Plaintext vars — dashboard → Worker → Settings → Variables:
#    ALLOWED_ORIGIN   = https://azoneofficial.com
#    COMPANY_DOMAIN   = azoneofficial.com
#    GOOGLE_CLIENT_ID = <your OAuth client id>

# 4. Deploy — this now also attaches the /api/* routes
npx wrangler deploy
```

## Google Cloud console (one-time)

Credentials → your OAuth 2.0 Client ID:

| Field | Value |
|---|---|
| Authorized JavaScript origins | `https://azoneofficial.com` |
| Authorized redirect URIs | `https://azoneofficial.com/api/v1/auth/google/callback` |

The redirect URI must match **exactly** — scheme, host, and path. If it does
not, Google shows `redirect_uri_mismatch` instead of the account picker.

## What happens on first login

- `you@azoneofficial.com` → account auto-created **active**, role `marketing`,
  redirected to `/admin`. An existing admin can then raise the role (COO,
  finance, live manager, …) from the admin panel — staff roles land in `/portal`.
- Any other Google account → active `customer`, redirected to `/account`.
- Email+password registration (non-Google) still goes through pending approval.

Your own first account: sign in with your `@azoneofficial.com` Google account,
then use the one-time `SETUP_TOKEN` bootstrap (see `docs/ADMIN_GUIDE.md`) to
promote it to super admin.

## Verify

```bash
curl -s https://azoneofficial.com/api/v1/health
# → {"ok":true,...}   (any JSON = the route is attached; 404 page = it is not)
```

Then open `https://azoneofficial.com/api/v1/auth/google` in a browser — you
should land on Google's account picker, not a 404.

## One caution: www

Use `https://azoneofficial.com` (no www) for logging in. The session cookie is
host-scoped, and OAuth redirects go to the apex domain — signing in on
`www.` would set the cookie on the wrong host. Best practice: add a Cloudflare
redirect rule sending `www.azoneofficial.com/*` → `https://azoneofficial.com/$1`
so nobody ends up there at all.

---

## History (do not remove)
| Version | Change |
|---|---|
| v1.4.2 | Worker routes declared in wrangler.toml; this guide added after /api/v1/auth/google 404'd in production (route was never attached). |
