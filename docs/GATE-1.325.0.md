# GATE 1.325.0 — Global UI System, phase D group 2: HR, Staff, Leave, Claims

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only: no route, permission, approval rule, calculation or table changes.
**Authority:** the CEO, 16-11-2026: *"HR / Staff / Leave / Claims. That release will also turn the Apply Leave and Submit Claim tabs into buttons that open the form in a side panel"*. That is decision D-3, approved with the Phase A audit, now built.
**Sits on:** 1.324.0, which is on the PC and not deployed.

## What changes on the screen

### Leave (D-3)

- **Apply Leave is no longer a tab.**
  - The gold **Apply Leave** button at the end of the tab row (**Apply** on a phone) opens the same three steps in the side drawer: Leave Details, Review and Submitted.
  - The checks, the working-day count, the route preview, the certificate upload and the submit are unchanged.
  - Leave Balance Impact and Approval Route sit beside the form.
- **Closing the drawer:**
  - A half-written application asks before it is thrown away.
  - A submitted one closes without asking.
- **Old links still work.** A link that still asks for the old view opens the drawer over the Overview. This covers the Dashboard's Apply Leave quick action and any `?view=apply` address.
- **Switches:**
  - The **Month / By person** calendar switch and the **half-day** choice are now the one view switch.
  - On the review step the half-day choice is read only, with the reason "Back to change it".
- **On a desktop**, the company leave register fills the screen and scrolls inside.

### Claims (D-3)

- **Submit Claim is no longer a tab.**
  - **Submit claim** opens the same three-step form in the drawer, with My Claim Info and Required Documents beside it.
  - The draft is kept if the drawer is closed.
  - Submitting, or updating a claim, closes the drawer and opens My Claims, as before.
- **Other ways in:** Edit on a claim and `?view=submit` open the same drawer.
- **The claim's lines** (date, category, description, amount) now lay out by the form's own width. In the narrower drawer, a column never collapses to one letter.
- **Switches:** Which claims (Waiting for my approval, All pending, Ready for payment, All claims), the claim type and the report basis are now the one view switch.

### Staff

- **Tabs:** the profile and record sections are the one tab row (gold underline).
- **Switches:** the directory's List / Grid and the roles filter (Everyone / Not written yet / Written) are the one view switch.
- **On a desktop**, the directory table fills the screen. Staff → Directory now fits 1440 × 900; it was 1,072 px.

### HR

The lifecycle sections (Joining, Probation, Letters, Training, Leaving) are the one tab row.

### System health ("fix this error too")

**The error in the list is an old record.** The Tasks page sent it while the portal ran v1.319.0, about a 402 px overflow in Staff Performance. It was fixed in 1.321.0.

**Checked again on this build:** Tasks → Overview at 320, 360, 375, 390, 402, 414 and 430 px has nothing past the screen's edge. `tests/browser/tasks-unified.py` checks 402 px on every run.

**What changes:** the log is never edited. A row reported by an older version now carries a chip, "From v1.319.0 - this portal is v1.325.0", so a fixed fault is not read as a live one.

## Measured at 1440 × 900 (page height in px, in the fixture)

| View | 1.324.0 | 1.325.0 |
|---|---|---|
| Staff → Directory | 1,072 | **900 (fits)** |
| Leave → Apply Leave | 932 (a tab) | a drawer over the page |
| Claims → Submit Claim | 956 (a tab) | a drawer over the page |
| Leave → Overview, My Leave | 900 | 900 |
| Claims → My Claims, Approvals, Reports | 900 | 900 |

**Still taller than the screen:**

| View | Height (px) |
|---|---|
| Staff → Organisation | 1,871 |
| Staff → Departments & Roles | 2,024 |
| Staff → Overview | 1,076 |
| Staff → Staff Records | 1,030 |
| Leave → Approvals & Management | 1,926 |
| Claims → Overview | 1,213 |
| HR → Calendar & Holidays | 1,300 |

These hold several cards each, so the page scrolls.

**Not changed in this group:**
- Leave Management's three figure tiles. They sit inside a card, and the strip there would be a card in a card.
- Team Map's department chips.
- Org chart's Edit toggle.

## Evidence (executed in the sandbox)

- **`tests/ui-system.mjs`:** 47 checks; all 41 deliberately broken versions are caught. New for group 2:
  - D-3 for both forms (never tabs, the same component and checks, the old links, the discard rule, a submit that closes).
  - The group's switches and tab rows.
  - The filling lists.
  - The drawer's one `dirty` value.
  - System health's older-version mark.
- **Ratchets lowered:**
  - Hand-made tab rows: 15 → **13**.
  - Private switch styles: 45 → **42**.
- **`tests/browser/ui-system.py`** adds, at 1440 and 390:
  - Apply Leave and Submit Claim are not tabs, and their buttons open the drawer.
  - A half-written application asks before it is thrown away.
  - The old `?view=apply` and `?view=submit` links open the drawers.
  - No field in the claim drawer is squeezed and no heading breaks letter by letter.
- **Adapted (intent kept; the Apply and Submit tabs became the approved buttons):**
  - Node: `interface-v3`, `tab-zones`, `unpaid-leave`.
  - Browser: `leave4`, `leave-timeline`, `claims4`.
- **Browser runs on the final build:**
  - `ui-system` 238/238
  - `claims4` 69/69
  - `claims-timeline` 48/48
  - `overflow-sweep`: 270 of 270 screens clean (8 role/width runs)
- **Browser runs on the build before it** (identical except the claim lines' container rule):
  - `leave4` 59/59
  - `leave-timeline` 62/62
  - `staff4` 49/49
  - `hr4` 62/62
  - `positions` 46/46
  - `ecc4` 208/208 (the Dashboard's Apply Leave and Submit Claim quick actions)
  - `dashboard-e2` 49/49
- **Full guard run** (`node scripts/run-guards.mjs`, 16-11-2026): **[OK] all 209 guards passed.**
- **Lint and types:** lint 0 errors, 114 warnings (unchanged); tsc clean.

## Deploy notes

- No migration.
- Files retired: none.
