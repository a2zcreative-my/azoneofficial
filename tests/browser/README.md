# Browser checks

The guards in `scripts/run-guards.mjs` read source. These read a **rendered
page**, and they exist because three bugs in September 2026 were invisible to
everything else:

| Bug | Why source-reading guards missed it |
| --- | --- |
| The Ecommerce grid blowout (v1.174.1) | A grid track grew to its widest item. Only a browser computes that. |
| The toast as a ghost band (v1.174.2) | Custom properties inherit through the DOM, not the stacking order. |
| The register shredded to one letter per line (v1.174.4) | **Nothing overflowed.** The text broke *inside* its own column. |

## Run them

```sh
pnpm build
node tests/browser/serve.mjs out 4177 &

WIDTH=402 xvfb-run -a python3 tests/browser/webkit-overflow.py   # anything past the page box
xvfb-run -a python3 tests/browser/table-shred.py                 # a column narrower than its own longest word
```

`ROLE=` on the server swaps the signed-in role, which is how the role-aware
dashboard (v1.175.0) is checked:

```sh
ROLE=ceo        node tests/browser/serve.mjs out 4177   # company and decisions lead
ROLE=sales_marketing node tests/browser/serve.mjs out 4177
ROLE=live_host  node tests/browser/serve.mjs out 4177   # the clock leads, as before
```

## Prerequisites

System packages, deliberately **not** repository dependencies (the interface
programme installs nothing): `webkit2gtk-driver`, `xvfb`, and Selenium for
Python. WebKit — not Chromium — because the owner's phone is Safari, and the
grid blowout reproduced only there.

A Chromium sweep is worth running too where Playwright is available; it is not
in this repository because adding it would mean adding a dependency.

## The rule this directory exists to enforce

**A clean sweep means nothing if the card rendered empty.** `fixture.mjs` must
carry a row for every endpoint a card reads — three endpoints went un-fixtured
for two days and every probe honestly reported zero — and those rows must carry
the company's real shape of data: long Malaysian names, RM amounts with
thousands, a company name with a bracket in it. That is what overflows, and
that is what gets shredded.
