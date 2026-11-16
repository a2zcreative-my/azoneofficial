# GATE 1.326.0 — My Tasks as a register beside the task; the form drawer (Apply Leave, reused by Submit Claim)

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only: no route, permission, approval rule, calculation or table changes.
**Sits on:** 1.325.0, which is on the PC and not deployed.

**Authority:** the CEO, 16-11-2026:

> *"Improve Tasks → My Tasks based on the attached screenshot ... Keep the task list on the left and selected task details on the right ... Fit the main workspace within one viewport ... Fix the layout at the shared component/CSS level"*

> *"Improve Leave → Apply Leave drawer using the attached UI reference ... Keep Cancel and Review buttons in a sticky footer ... Reuse the improved drawer structure for other eligible system forms."*

## What changes on the screen

### Tasks → My Tasks (from 1024 px)

**The list on the left is now the one compact task table, the Project Register's design.**
- It has three columns:
  - **Task**, with its project and due day ("Overdue: 15 Sep 2026" in red);
  - **Status**;
  - **Progress**.
- **The task on show is marked gold.** Headers sort; 10 rows a page, with the pager under the rows. The task's name is a button, so the keyboard opens it too.

**The register (40%) and the task (60%) are held to the screen.** Both end on one line, and each scrolls inside. The page does not scroll at:
- 1024 × 768
- 1280 × 800
- 1366 × 768
- 1440 × 900
- 1920 × 1080

The page measured 1,408 px at 1440 × 900 before.

**The task on the right is compact, and says each thing once:**
- no icon well;
- Priority, Due, Assigned to and Progress in one facts strip. Progress says where its figure comes from ("reported in updates" or "checklist 2/3");
- the four steps;
- the decisions bar, which no longer repeats the state chip and the figure;
- the five section tabs (Details, Checklist, Updates, Files, Activity). Only the chosen one shows.

The facts sit four across only when the pane itself is wide enough.

**Below 1024 px nothing changes:** the card list is kept, and a task opens full screen in the drawer.

### Leave → Apply Leave (the form drawer)

- **The drawer:** a wide panel on a desktop and the whole screen on a phone. The calendar icon sits in a gold well, and the title says "Submit a new leave request for approval".
- **The steps:** Leave Details → Review → Submitted, in their own row under the title. The step in hand is gold and underlined.
- **The fields,** in one aligned column:
  - Leave Type;
  - Date Range (first day – last day) with Working Days beside it;
  - Reason, with its 0 / 500 counter;
  - the attachment drop area.
- **Beside the fields:**
  - **Leave Balance Impact** (before, this request, after);
  - **the Approval Route,** which starts with "You · Submit the request", followed by the route the server works out.

  On a phone they sit under the fields.
- **The buttons are pinned in the drawer's foot:** Cancel and Review, then Back and Submit request. Cancel with something typed asks first ("Discard your changes?").
- **Removed:**
  - the second "Apply Leave" title inside the drawer;
  - the card around the form;
  - the cards around each approver.
- **Unchanged:** the working-day count, the balance, the route, the checks, the certificate rule and the submit. The server's preview (`/staff/leave/quote`) still decides all of them.

### Claims → Submit Claim (the same structure, reused)

- The three steps are in the step row.
- My Claim Info and Required Documents are the aside panels.
- Close / Back, Next and Submit claim are pinned in the foot.
- The duplicate "Submit a claim" heading is gone. Editing keeps its line and its cancel.
- The form, its checks and its submit are unchanged.

### Every drawer: it now reaches the bottom of the screen

**Found while checking the reference:** every drawer stopped 24 px above the bottom of the screen.

**Why:** the tab page's stack gives each child a bottom margin, and that margin lifted the fixed drawer layer.

**The fix:** the drawer layer (`.erp-drawer-backdrop`) takes no margin.

**Not changed:** the 15 px scrollbar gutter that `html` always keeps (`scrollbar-gutter: stable`, since v1.4.182) still shows as a thin strip at the drawer's right on Windows. Drawing the drawer under the gutter clips its close button, and dropping the gutter would move the page 15 px each time a drawer opens. It is reported, not changed.

## The shared pieces (for any other staged form in a drawer)

| Piece | Where | What |
|---|---|---|
| `SideDrawer form icon` | components/ui/side-drawer.tsx | The widest panel (66 rem) on a desktop, full screen on a phone, the icon in a gold well |
| `DrawerSteps` / `FormSteps` | side-drawer.tsx, components/ui/form-steps.tsx | The one stepper, in the drawer's step row |
| `DrawerFoot` | side-drawer.tsx | The form's own buttons, pinned in the drawer's foot (a portal: the form keeps its state); set aside while the discard question asks |
| `DrawerForm` / `DrawerPanel` | side-drawer.tsx | The fields beside an aside: side by side when the drawer is 46 rem wide or more (a container query), one column otherwise |
| `useDrawerClose()` | side-drawer.tsx | A Cancel that goes through the drawer's own close, so typing is never lost without asking |
| `.erp-dropzone` / `.erp-file-chip` | styles/erp-v3.css | The attachment area and the chosen file |
| CompactTaskTable `picked` / `dense` / `fill` | components/portal/task-table.tsx | The row on show, the narrow register, the height of its column |

Tokens and `--type-*` roles only, with the house breakpoints.

## Evidence (executed in the sandbox)

### Node guards

- **`tests/ui-system.mjs`:** 55 checks; all 50 deliberately broken versions are caught. New checks:
  - the register;
  - the split held to the screen;
  - the pane saying things once;
  - the container facts;
  - the form drawer;
  - Apply Leave and Submit Claim on it.
- **`tests/tasks-unified.mjs`:** 36 checks, 23 mutations. Adapted: My Tasks is the register from 1024 px.
- **Unchanged and passing:**
  - interface-v3 (265)
  - tailwind-retired (265)
  - tab-concept (242)
  - tab-zones (108)
  - unpaid-leave (101)
  - leave-module (35)

### Browser suites on this build

| Suite | Result |
|---|---|
| `ui-system` | 272/272 |
| `tasks2` | 105/105 |
| `tasks5` | 80/80 |
| `tasks-unified` | 112/112 |
| `task-progress` | 84/84 |
| `task-closure` | 135/135 |
| `ui-corrections` | 12/12 |
| `leave4` | 59/59 |
| `leave-timeline` | 62/62 |
| `claims4` | 69/69 |
| `claims-timeline` | 48/48 |
| `ecc4` | 208/208 |
| `dashboard-e2` | 49/49 |
| `staff4` | 49/49 |
| `hr4` | 62/62 |
| `sales2` | 44/44 |
| `overflow-sweep` | 270 of 270 screens clean |

**`ui-system` adds:**
- My Tasks at 1440 × 900, 1366 × 768 and 1024 × 768: the page does not scroll, both columns end on one line, the register has no sideways scroll, and one row is marked. At 390 the card list is kept.
- Apply Leave at 1440, 1024, 390 and 320:
  - the steps sit in the step row, outside the scroll;
  - Cancel and Review stay in the foot and on screen after the form scrolls;
  - the aside sits beside the fields on a desktop and under them on a phone, with the drawer full screen;
  - nothing goes past the drawer's edge;
  - Cancel with typing asks first.
- Submit Claim at 1440 and 390: the same structure.

**Adapted (intent kept; the cards became the register, and the buttons and steps moved into the drawer's rows):**
- Browser: `tasks2`, `tasks5`, `task-progress`, `task-closure`, `ui-corrections`, `leave4`, `claims4`.
- Node: `tasks-unified`, `tasks2`, `tasks5`, `action-feedback`.
- What changed in them:
  - The review bar's word "Review" is now read from its next-step line.
  - The tasks2 mutation "a breakpoint of its own" now anchors on the pane's remaining phone rule, because the facts' 1024 px rule became a container query.
  - In action-feedback, the "Choose the dates" line is found in the pinned foot, within 16,000 characters of its rule instead of 12,000. The two impact and route panels now sit between them.

### Full guards, lint and types

- **Full guard run** (`node scripts/run-guards.mjs`, 16-11-2026): **[OK] all 209 guards passed.**
- **Lint and types:** lint 0 errors, 114 warnings (unchanged; the one new warning was fixed); tsc clean.

## Deploy notes

- No migration.
- Files retired: none.
- Styles removed with their screens: the private leave and claim steppers, the leave field and drop styles, and the claim step bar.
