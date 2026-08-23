# Automatic deploys — setup, once

**Today:** I send a zip → you unzip → you run `DEPLOY.bat` → it goes live.
**After this:** a change is pushed → Cloudflare builds it, runs the guards,
publishes a preview → you tap **Merge** on your phone → it is live.

The setup below is about **15 minutes and you only do it once.** After that
your only job per change is tapping Merge.

---

## What is actually being built

Two things get published from one repository:

| Worker              | What it is                 | Built from       |
| ------------------- | -------------------------- | ---------------- |
| `azoneofficial`     | the website + portal       | repo root        |
| `azoneofficial-api` | the engine (login, D1, R2) | `worker/` folder |

Cloudflare connects to a repository **per worker**, so you connect the same
repo twice with a different root folder. That is normal.

---

## Step 1 — put the code on GitHub

Create an **empty private** repository at <https://github.com/new>:

- Name: `a2z-creative`
- **Private**
- Do **not** tick "Add a README", ".gitignore" or a licence. It must be empty.

Then, in the unzipped folder on your PC (this folder already contains the
full history as a git repository, so there is nothing to initialise):

```bash
git remote add origin https://github.com/YOUR-USERNAME/a2z-creative.git
git push -u origin main
git push origin dev
```

If `git` is not installed on your PC: <https://git-scm.com/download/win>,
accept every default.

---

## Step 2 — connect the WEBSITE worker

Cloudflare dashboard → **Workers & Pages** → **azoneofficial** → **Settings**
→ **Build** → **Connect** → pick the `a2z-creative` repo, then:

| Field                                    | Value                       |
| ---------------------------------------- | --------------------------- |
| Production branch                        | `main`                      |
| Root directory                           | _(leave empty — repo root)_ |
| Build command                            | `npm run ci`                |
| Deploy command                           | `npx wrangler deploy`       |
| Build previews / non-production branches | **ON**                      |

`npm run ci` is typecheck → the full guard suite (13 at v1.40.1 — run-guards.mjs is the authoritative list) → build. If any guard fails the build
stops with a non-zero exit code and **nothing is published** — the live site
keeps running the previous version.

---

## Step 3 — connect the API worker

Same dashboard, worker **azoneofficial-api** → **Settings** → **Build** →
**Connect** → the same `a2z-creative` repo:

| Field                                    | Value                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Production branch                        | `main`                                                                      |
| Root directory                           | `worker`                                                                    |
| Build command                            | `npm install --no-audit --no-fund && node ../tests/worker-compile-gate.mjs` |
| Deploy command                           | `sh ../scripts/deploy-api.sh`                                               |

v1.40.1: `deploy-api.sh` now also runs `tests/sql-schema-check.mjs` itself (the build that applies migrations must be the one that checks them — audit M18), refuses to publish from a non-production branch at all (new code against an un-migrated database silently breaks the ELFIA movements feed — audit M10), and **fails the build unless the live `/api/v1/health` reports this build's version** (the live API sat at 1.32.1 for days with every build green — audit B5).
| Build previews / non-production branches | **OFF** — see the warning below                                             |

### Why previews are OFF for the API, and must stay off

**There is only one database.** A preview deployment gets its own URL but is
still bound to the **real** `azoneofficial` D1 — the one holding today's
invoices, payroll and attendance. A preview of the API could therefore write
to live data before anyone has reviewed it, and `d1 migrations apply` from an
unreviewed branch would alter the live schema.

`scripts/deploy-api.sh` refuses to run migrations from any branch other than
`main` as a second line of defence. Do not remove that check.

The website preview is safe and stays ON — it is static files, and it talks to
the same live API your phone already talks to.

---

## Step 4 — how you ship from now on

1. A change is pushed to the **`dev`** branch.
2. Cloudflare builds it. Guards fail → nothing happens, you are told.
   Guards pass → you get a **preview URL**, safe to open on your phone.
3. Happy? On GitHub, open the pull request from `dev` into `main` and tap
   **Merge**. That is the one tap.
4. `main` builds again and publishes to **a2zcreative.my**. The API build
   applies any database migrations first and then prints the live health
   check into the build log.

Not happy? Do not merge. Nothing reached customers.

---

## What still needs a human

Be clear-eyed about what this does and does not cover.

- **Four browser guards do not run in Cloudflare's builder** — it has no
  Chromium. `bm-coverage`, `leaderboard-sales-floor`, `location-scenarios`,
  `no-false-attendance`, plus the `scratch/` end-to-end tests, are still run
  before a release is handed over. `npm run guard` prints this list every time
  so it cannot be quietly forgotten.
- **Google Fonts is a build-time dependency.** `app/layout.tsx` fetches
  Poppins from Google while building. If Google is unreachable during a build,
  the build fails and nothing deploys — annoying, but it fails safe. Hosting
  the font file inside the repo would remove that dependency entirely; worth
  doing if it ever bites.
- **The two workers deploy independently** and can finish a minute apart, so a
  release that changes the API _and_ the pages it feeds has a brief window
  where one is newer than the other. It has not mattered so far because API
  changes stay backwards-compatible; keep it that way.
- **Secrets are not in the repository and must never be.** They live in
  Cloudflare, set with `wrangler secret put`. The repository is private, but
  "private" is one mis-click from "public".

---

## If a build fails

Cloudflare shows the full log under the worker → **Deployments**. The guard
runner prints exactly which guard failed and why. **A failed build never
touches the live site** — a2zcreative.my keeps serving the last good version.

The old `DEPLOY.bat` still works as an emergency path, but Cloudflare refuses
a command-line deploy over a git-connected worker, so you must disconnect the
repo first and **reconnect it afterwards** — otherwise automatic deploys stop
and nobody notices until a change silently fails to appear.
