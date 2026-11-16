# GATE 1.323.0 — Global UI System: the shared foundation and the pilot

**Status:** BUILT AND TESTED. **NOT DEPLOYED.** **STOPPED FOR THE CEO'S VISUAL REVIEW** before phase D (the rollout to every module).
**Migration:** none. Screens only: no route, permission, approval rule, calculation or table changes.
**Authority:** the CEO, 16-11-2026, the "A2Z OS — Complete Global UI System Restructuring" brief. The Phase A audit is `claude/UI-SYSTEM-STAGE-0-AUDIT.md`, and the CEO approved its decisions D-1 to D-7 with *"Approve as per recommend"*.
**Sits on:** 1.322.0, which is on the PC and not deployed.

## What changes on the screen

### Every page with figures (the one KPI strip: D-1, D-5)

- **The figure strip is one card.** On every page, a row of figures is now one white card, with its figures as connected segments and a thin line between them. This matches the Tasks Overview, the master. Before this, each figure was its own floating card: 178 of them across 42 views.
- **Columns:**
  - Every figure sits on one row from 1280 px.
  - Three a row from 1024 px.
  - Two a row on a tablet and a phone, with an odd last figure across the whole row.
  - No figure is hidden.
- **The figure** uses the master's size: 18 px, bold.
- **A pressed figure** (one that filters a list) shows the master's gold wash and gold underline.
- **Removed:** the pages' own overrides that re-laid their figures. This covers Assets, Payroll, Dashboard, News, Hotels, Executive and Desk.

### One card radius (D-1)

- Every card inside the portal has the one 18 px radius.
- Every control has the one 12 px radius.

### One view switch, one tab row (D-2)

- **A view switch** (Table / Board, List / Board, Month / Week / List) is the master's segmented toggle: a grey track with the chosen option raised in white. It now also carries a count. The Desk's inbox filters use it too: All, Awaiting My Decision, Requires My Response, Alerts and Completed.
- **The Tasks Overview's Staff / Activity / Actions panel** is now the tab row (gold underline), because those are three different contents.
- **On a phone** the switch is one row that slides sideways. Before, the Desk's five filters stacked into a three-line block.

### The main list fills the screen on a desktop (D-4)

- **On a desktop (from 1024 px):** a page's main list takes the height left on the screen and scrolls inside itself. Its pager and its note stay on the screen under it.
- **On a phone and a tablet:** nothing changes, and the page scrolls as before. This follows the house rule: never a scroller inside the page on a phone.
- **On a very short window or at a large text size:** if less than 320 px is left, the list does not do this and the page scrolls.

### The pilot screens

| Screen at 1440 × 900 | Before (1.322.0) | Now |
|---|---|---|
| Desk → Action Inbox | 2,219 px tall (twenty 87 px rows) | **fits the screen.** The 20 rows scroll inside the inbox. The column names stay in view. The next step is one line beside Open, with its full words on hover. |
| Desk → Overview | fits | fits |
| Tasks → Overview | 1,141 px | **fits the screen.** The queue and the panel beside it each scroll inside. Every column of the queue is in view (it ran 12 px sideways before). |
| Dashboard → Overview | 1,003 px | **924 px.** It fits when no alert is raised. With the fixture's backup alert it is 24 px over and the page scrolls that much. See *Open for your review*. |

On the **Dashboard**, Quick Actions is now one compact row (the icon beside the words, the master's 44 px buttons). A decision's state and its Review now sit side by side on a desktop. The alert band is one compact line.

## What does not change

- No figure, count, permission or rule. Each strip shows the same figures from the same reads.
- No function is removed. Each Desk row keeps its next step (in full on hover), and the phone still shows each inbox row as a card.
- Light is still the portal's default. The dark theme is kept and tested (D-7).
- No global overflow hiding was added.
  - The one global clip that exists is the `body` pair from v1.23.8 (iOS ignores `hidden` on `body`). It predates this brief.
  - The new guard pins it as the only one. The sweeps measure spills under it.

## Evidence (executed in the sandbox)

- **`tests/ui-system.mjs` (new, registered):** 32 checks. All 28 deliberately broken versions were caught.
  - **It covers:**
    - the strip is the card and a tile is never a card;
    - a fragment's figures are counted;
    - two a row on a phone, with an odd last figure across the row;
    - one radius;
    - PillSwitch and LineTabs as the only switches on Tasks and the Desk;
    - FillPanel acts only from 1024 px, never below its minimum, never hides, and keeps the pager on the screen;
    - tokens and the house breakpoints;
    - no new global clip.
  - **Its ratchets may only fall:**
    - hand-made tab rows outside the shared pieces: **18**;
    - private switch styles: **49** (in 16 files). Phase D lowers them.
- **`tests/browser/ui-system.py` (new):**
  - **1440 × 900:** every view of every tab (28 tabs). Every KPI strip on screen must be one connected card: no gap, no segment drawn as a card, as many cells as it says, one row, inside the page. It also checks no sideways page and no page error.
  - **390 × 844:** every tab. The strips must be two a row, with an odd last figure across.
  - **Dark theme:** Dashboard, Desk, Tasks, Payroll and Sales at both sizes.
  - **The pilot:** the Desk inbox and the Tasks Overview at 1440 (fill, pager on screen, no sideways scroll, header stays) and at 390 (no inner scroller).
- **Adapted (intent kept; old tile and switch → the approved ones):**
  - **Node:** `desk5`, `one-desk`, `executive-workspace`, `sales-workspace`, `sales2`, `tasks-unified`.
  - **Browser:** `desk5`, `dashboard-e2`, `tasks-unified`, `tasks2`, `tasks5`, `task-progress`.
- **Browser results on the final build** (the fixture servers):
  - `ui-system` 201/201
  - `desk5` 168/168
  - `tasks-unified` 112/112
  - `tasks2` 105/105
  - `tasks5` 80/80
  - `task-progress` 84/84
  - `dashboard-e2` 49/49
  - `sales2` 44/44
  - `sales4` 356/356
- **Browser results on the build just before it** (the build without the margin and phone-switch fixes):
  - `shell-e1` 30/30
  - `shell-3` 27/27
  - `sales-e3` 33/33
  - `ui-corrections` 12/12
  - `overflow-sweep` 270 of 270 screens clean (8 role/width runs)
- **`ui-corrections`:** its two Tasks checks had been broken since 1.321.0 (they looked for the old register's status dropdown and project chip). They now read the state chip and the My Tasks card's project line. The intent is the same: "In progress", never "Pending"; the project's name, never "Project #n".
- **Lint:** 0 errors, 114 warnings (unchanged). tsc is clean.
- **Full guard run** (`node scripts/run-guards.mjs`, 16-11-2026, on the final source): **[OK] all 209 guards passed**, including the new `ui-system`.

## Open for your review (decisions before phase D)

1. **Dashboard with an alert:** with an alert band showing, the Overview is 24 px taller than a 900 px screen. I can do one of two things:
   - tighten the space between the Dashboard's cards (16 → 12 px), so it fits; or
   - leave the Dashboard as the one page that may scroll a little.
2. **Phase D order:** the next module groups, each a separate release, with screenshots before and after:
   - Sales, Payroll and Finance;
   - HR, Staff, Leave and Claims;
   - the rest.
3. Not touched yet:
   - the form tabs (Apply Leave, Submit Claim → a button opening the drawer, D-3);
   - the legacy utilities (D-6).

## Deploy notes

- No migration.
- Files retired: `components/ui/metric-strip.module.css` (MetricStrip now draws through the KPI strip). On the PC it is moved to `_to_delete/` for you to delete. Nothing imports it.
