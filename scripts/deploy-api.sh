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
#
# v1.40.1 (AUDIT M18, B5, deploy-state B):
#   - The schema guard now runs HERE, on the build that actually applies
#     migrations and publishes the worker. Before this, sql-schema-check ran
#     only on the WEBSITE worker's build — the API could ship schema drift
#     that the site's green build never saw.
#   - The health check at the end now ASSERTS the deployed version instead of
#     printing "expected: …" and exiting 0 regardless. The audit found the
#     live API sitting at 1.32.1 while main was at 1.34.0, invisible because
#     a failed or missing deploy looked identical to a good one in the log.
#   - A NON-production branch no longer deploys AT ALL. The old else-branch
#     skipped migrations but still ran `wrangler deploy` — publishing new
#     code against an un-migrated database, which for the ELFIA bridge means
#     answering the store 200 with empty lists while deducting nothing
#     (audit M10). New code + old schema is the dangerous half; refuse it.
set -e

PRODUCTION_BRANCH="main"

echo "branch: ${WORKERS_CI_BRANCH:-<unknown>}"

echo "→ schema guard: every query in the worker must PREPARE against the migrated schema"
(cd "$(dirname "$0")/.." && node tests/sql-schema-check.mjs)

if [ "$WORKERS_CI_BRANCH" = "$PRODUCTION_BRANCH" ]; then
  echo "→ production branch: applying database migrations"
  CI=true npx wrangler d1 migrations apply azoneofficial --remote
else
  echo "→ NOT the production branch: neither migrations nor deploy run from here."
  echo "  (one D1 database holds live invoices; and code without its"
  echo "   migrations silently breaks the ELFIA movements feed — audit M10)"
  exit 0
fi

echo "→ publishing the API worker"
npx wrangler deploy

# v1.40.1: assert, don't hope. The deployed worker must report the version
# this build was made from, or the build fails loudly. Retries cover edge
# propagation; `|| true` on the curl keeps set -e from masking the real
# comparison below.
# resolved from the script's own location, so this works from any cwd
EXPECTED_VERSION=$(node -p "require(process.argv[1]).version" "$(dirname "$0")/../package.json")
echo "→ verifying the live API reports version ${EXPECTED_VERSION}"
ATTEMPT=1
while [ $ATTEMPT -le 6 ]; do
  sleep 10
  LIVE=$(curl -s -m 20 https://a2zcreative.my/api/v1/health || true)
  echo "  attempt ${ATTEMPT}: ${LIVE}"
  case "$LIVE" in
    *"\"version\":\"${EXPECTED_VERSION}\""*)
      echo "→ live API is on ${EXPECTED_VERSION} — deploy verified."
      exit 0 ;;
  esac
  ATTEMPT=$((ATTEMPT + 1))
done
echo "[X] the live API never reported version ${EXPECTED_VERSION}."
echo "    The publish either failed, hit the wrong worker, or the route is"
echo "    not serving this deploy. This build is marked FAILED so it cannot"
echo "    be mistaken for a good one."
exit 1
