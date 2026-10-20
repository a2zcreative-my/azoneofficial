# Browser checks

These probes inspect a rendered static export in WebKitGTK. The ordinary guard suite includes source and executable runtime checks, but does not run these browser probes.

## Repeatable matrix

On Linux with `xvfb-run`, `WebKitWebDriver`, Python 3 with Selenium, and MiniBrowser at `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser`:

```sh
pnpm test:browser
# Faster environment/fixture smoke: CEO, 390px, English, light
pnpm test:browser --smoke
```

The runner checks prerequisites, builds a fresh static export, starts an isolated loopback fixture server on an available port, and runs overflow, table shredding, UI fit and accessibility probes. It stops at the first failure. Child processes are bounded by timeouts and cleaned up on completion or interruption.

The full matrix has 24 scenarios: CEO, sales_marketing and live_host; 390px and 1280px; English and Malay; light and dark. Permitted tabs and translated labels come from `lib/portal-tabs.ts` and `lib/i18n.ts`. No second permissions model is added. This checks navigation under fixture roles; it does not validate backend authorization.

`browser-results/latest.json` records the commit, dirty-worktree listing, run scope, timestamps, completed probes and failure reason. Probe/build logs are stored alongside it; this directory is ignored by Git. A dirty-worktree report describes local work based on that commit, not verification of the pristine commit. Smoke success is not full-matrix success.

Failures include missing tools, failed fresh build, timeout, missing completion marker, reported findings, skipped/missing tabs, unavailable keyboard focus and unknown fixture GET endpoints. Missing coverage never counts as a green sweep. The command exits nonzero for these conditions. The local `pnpm ci` and `PUSH.bat` commands remain unchanged and do not automatically run this gate. The new GitHub workflow below invokes it separately. A successful Linux matrix report is still required before treating a UI release as browser-verified.

## What each probe checks

| Probe | Findings |
| --- | --- |
| `webkit-overflow.py` | Elements outside the page content box |
| `table-shred.py` | Table columns narrower than their longest word |
| `ui-audit.py` | Repeated headings, shredded labels, nested scroll traps, orphan tiles, clipped labels and trapped dialogs |
| `a11y-audit.py` | Unnamed controls and missing visible keyboard focus |

All probes now share viewport, language/theme setup and tab navigation in `probe_common.py`. Navigation checks the desktop/phone bar and More sheet. A requested tab that cannot open is an error. Accessibility must obtain real keyboard focus; if the display server does not grant it, the result is incomplete and fails instead of claiming focus passed.

## Individual debugging

```sh
pnpm build
ROLE=ceo node tests/browser/serve.mjs out 4177
# In another terminal, select labels in the chosen language:
PREVIEW_URL=http://127.0.0.1:4177 WIDTH=390 LANG_UI=en THEME=dark TABS=Sales,Claims xvfb-run -a python3 tests/browser/ui-audit.py
```

Individual probes fail on findings too, but use the runner for fixture coverage, timeouts and report capture. Default tab lists are intended for the CEO fixture. Narrow a list explicitly when debugging another role; do not silently ignore inaccessible tabs.

## Fixture coverage

`fixture.mjs` must explicitly handle every GET endpoint requested by a tested screen. The fixture server records unknown paths at `/__fixture-status`; the runner fails on any. Unknown requests no longer receive a large generic empty response that can hide missing coverage. Known deliberately empty datasets remain valid, so endpoint coverage is necessary but not proof that every card has representative populated rows.

Use synthetic records with long names, large RM figures, empty/error states and realistic relationships. These layout fixtures do not exercise every save flow, offline retry or production-data shape. Those remain separate work.

## Current verification

12 October 2026: all 107 repository guards (including orchestration regression tests) and Python syntax validation passed locally. The Windows smoke invocation failed at prerequisite detection as expected: Linux/WebKitGTK is unavailable and WSL is not installed. **No WebKit sweep was completed on this machine.** See `docs/PROJECT-STATE.md` for the current guard-suite result. Do not describe this harness delivery as browser validation of the product.

## GitHub Actions

`.github/workflows/browser-validation.yml` prepares an Ubuntu 24.04 job on main pushes, pull requests and manual dispatch. The main-push trigger is the current local follow-up, not yet pushed. It installs the package.json-pinned pnpm, Node 24, locked frontend dependencies (`pnpm install --frozen-lockfile`) and locked Worker dependencies (`npm ci` in `worker`). It installs WebKitGTK, Xvfb, xauth and Python Selenium through apt, then runs typecheck, lint, all guards and the full browser matrix. No smoke shortcut, deployment step or production credentials are used.

`BROWSER_PYTHON=/usr/bin/python3` makes prerequisite detection and every probe use the interpreter apt installs Selenium into. Local Linux callers may set this variable to another executable with Selenium installed.

The job has a four-hour ceiling, cancels superseded runs on the same ref, and retains available `browser-results` evidence for 14 days even on failure. CI context is written before dependency setup; early setup failures may have only this context plus GitHub step logs, without a browser report. Actions are pinned to verified full commit SHAs. The workflow requests read-only repository access and checkout does not persist credentials.

The original workflow is committed and pushed in 3e42644. GitHub reported zero runs when rechecked on 12 October; direct main pushes did not match its original PR/manual-only triggers. This continuation adds the main-push trigger locally. It has passed YAML parsing and `actionlint` 1.7.12 validation (external shellcheck/pyflakes disabled); GitHub execution is still pending. Workflow presence does not make it a required branch check or block Cloudflare auto-deploys. Repository rules and deployment integration remain unchanged. After the first complete green run, decide whether to require `WebKit matrix` before merging. A failure must be fixed, not converted into a skipped fixture/tab or ignored focus check.
