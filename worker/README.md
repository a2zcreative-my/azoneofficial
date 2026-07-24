# azoneofficial-api (Admin/API Worker)

Separate Worker serving `/api/v1` — the public site stays static.

## Setup
```bash
cd worker
pnpm install
pnpm wrangler secret put SESSION_PEPPER       # random 32+ chars, generate once, never lose
pnpm wrangler secret put GOOGLE_CLIENT_SECRET # from the Google OAuth client (below)
pnpm migrate:prod                             # apply migrations to D1
```

## Google sign-in setup (one-time)
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (type: Web application)
2. Authorized redirect URI: `https://azoneofficial.com/api/v1/auth/google/callback`
3. Put the Client ID into `wrangler.toml` (`GOOGLE_CLIENT_ID`) and the Client Secret into the secret above
4. Sign-in rules: Google-verified `@azoneofficial.com` accounts are activated automatically (role: marketing — raise it in Users). Other Google accounts and all password registrations are created as **pending** until a super admin activates them.

## Create the first super admin (one-time bootstrap — nothing hardcoded)
1. `pnpm wrangler secret put SETUP_TOKEN` — paste a random 32+ character string (generate with a password manager)
2. After deploy, call once:
```bash
curl -X POST https://azoneofficial.com/api/v1/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"token":"<your SETUP_TOKEN>","email":"admin@azoneofficial.com","name":"Alīf","password":"<strong 12+ char password>"}'
```
3. The endpoint returns 410 Gone forever after — it only works while zero super admins exist and only with the token. You can then sign in normally at /login (email/password or Google with the same email — the accounts match by email).

## Routes implemented (v0)
- `GET  /api/v1/health`
- `POST /api/v1/enquiries` (public — contact form)
- `POST /api/v1/auth/login` · `POST /api/v1/auth/logout` · `GET /api/v1/auth/me`
- `GET  /api/v1/enquiries` (marketing+) · `PATCH /api/v1/enquiries/:id` (status)
- `GET  /api/v1/dashboard/summary` (marketing+)

## Not yet implemented
Products/posts/portfolio/testimonials/media CRUD, R2 uploads, rate limiting binding, admin UI. See ROADMAP.md.

## Route setup
In Cloudflare: attach this Worker to `azoneofficial.com/api/*` (or `api.azoneofficial.com`) so the static site and API share the origin the browser sees.
