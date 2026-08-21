#!/bin/sh
# Deploy command for the azoneofficial-api worker in Cloudflare Workers Builds.
# Root directory for that build must be:  worker
#
# v1.34.0. Why this is a script and not just `npx wrangler deploy`:
#
#   D1 MIGRATIONS MUST ONLY RUN FROM THE PRODUCTION BRANCH.
#   There is one database. A preview build is still bound to the REAL
#   azoneofficial D1 — Cloudflare gives a preview its own URL, not its own
#   data. So `d1 migrations apply --remote` from a work-in-progress branch
#   would alter the live database that today's invoices are being written to,
#   while nothing has been reviewed yet. The branch check below is the only
#   thing preventing that, so do not "simplify" it away.
#
#   CI=true is REQUIRED. Without it wrangler stops on an interactive
#   "About to apply N migration(s) — continue?" prompt. In a build container
#   nobody answers, and the older failure mode was worse: answering "n" exits
#   0, which would then deploy new code against an un-migrated database.
set -e

PRODUCTION_BRANCH="main"

echo "branch: ${WORKERS_CI_BRANCH:-<unknown>}"

if [ "$WORKERS_CI_BRANCH" = "$PRODUCTION_BRANCH" ]; then
  echo "→ production branch: applying database migrations"
  CI=true npx wrangler d1 migrations apply azoneofficial --remote
else
  echo "→ NOT the production branch: migrations skipped on purpose."
  echo "  (there is only one D1 database and it holds live invoices)"
fi

echo "→ publishing the API worker"
npx wrangler deploy

# A deploy that "succeeded" but left the API broken is the failure mode that
# actually happened on 19-08, and with nobody watching a terminal any more the
# build log is the only place it can be caught. Ask the live API what it is.
if [ "$WORKERS_CI_BRANCH" = "$PRODUCTION_BRANCH" ]; then
  echo "→ checking the live API"
  sleep 5
  curl -s -m 20 https://a2zcreative.my/api/v1/health || true
  echo ""
  echo "  Expected: {\"ok\":true,\"db\":true,\"version\":\"<this release>\"}"
fi
