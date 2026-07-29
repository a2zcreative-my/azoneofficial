# Deployment

## Pipeline
Developer → git commit → GitHub (`a2zcreative-my/azoneofficial`) → Cloudflare auto-deploy → Production (azoneofficial.com)

GitHub is the single source of truth. Every push to the production branch deploys automatically.

## Environments
- **Production**: `main` branch → azoneofficial.com
- **Development**: `develop` branch (Cloudflare preview deployments per branch/PR)

## Build
```bash
pnpm install
pnpm typecheck && pnpm lint
pnpm build          # next build → static export to /out (see next.config.ts)
```
Cloudflare serves `/out` per `wrangler.toml` `[assets]`.

## Rollback
1. Preferred: `git revert <bad-commit>` on `main` and push (keeps history honest), or
2. Cloudflare dashboard → Deployments → select previous deployment → Rollback.

## Phase 3 note
The admin CMS requires moving off static export (see ARCHITECTURE.md). Deployment will then use `wrangler deploy` with D1/R2 bindings; this file must be updated at that point.
