# GATE 1.329.0 — The one feedback modal: Attendance, Leave and Tasks say what happened

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only: no route, permission, approval rule, calculation or table changes.
**Sits on:** 1.328.0, which is on the PC and not deployed.

**Authority:** the CEO, 16-11-2026:
- *"Perform everything as I need this system ready without waiting further!"* This approves F-1 to F-5 of claude/FEEDBACK-MODAL-STAGE-0-AUDIT.md as recommended.
- *"Ensure that 1.328.0 and 1.329.0 done tonight without delay anything. All this must complete without my review."*

## What changes

### One component, one service (F-1)
`components/ui/feedback-modal.tsx` holds three pieces:
- **`FeedbackModal`**, the card. It has a status well, the title, one line, an optional chip and facts strip, the actions and the X.
- **`FeedbackProvider`**, mounted once in `app/portal/layout.tsx`. Two results never stack, and a routine success never replaces an error the person has not read.
- **`useFeedback()`**, which offers `show`, `processing` and `close`.

The card follows 1.328.0's rule:
- it sits centred at every width, inside the safe areas;
- it is 90% of the screen width, up to 360 px;
- it uses the house modal surface;
- it uses tokens and `--type-*` only.

`useSaveToast()` is a door onto the provider. It keeps the same name, the same arguments and the caller's words, so the 70 panels that call it take the card without being rewritten. It also gains a third variant, `"error"`.

### The rules (F-2, F-4)

| Result | Behaviour |
|---|---|
| Routine save, notice, info | **Passive:** it closes after the time its words take to read and never blocks a click. Only its X is live. |
| Error, acknowledged decision or submission, processing | **Waits for OK:** a dialog with focus on OK. Escape and X close it (not while processing), and focus returns. |
| Any result | Nothing retries by itself. |

### The clock
- On Shift's private PunchToast copy is deleted. Its messages go through the provider with the same words.
- A punch that did NOT happen waits for OK.
- The clock-in / clock-out confirmation from 1.328.0 is unchanged.

### Pilots (F-3)

**Attendance:**
- An overtime decision now says which decision was made:
  - "Overtime approved", with the chip "Goes to the payroll";
  - "Replacement leave credited", with "½ day" or "1 day";
  - "Overtime rejected", with "Not paid".
- It also gives the person, the day, the hours and the duration, and waits for OK.
- A forgotten-punch decision says whether it was approved or rejected, with the day and the time.
- A refusal says "Not decided" with the server's words, and waits for OK.

**Leave:**
- A decision says "Leave approved" only when the server's stage is approved.
- Any earlier stage says "Approved at your step", with the chip "Pending the next approval".
- Rejected, returned, withdrawn and resubmitted have their own words.
- Each shows the type, the dates and the days, and waits for OK.
- A refused decision or application waits for OK.

**Tasks:** a refused create, tick, change, delete or deliverable waits for OK.

### Not in this release (stage D of the plan)
- the error variant in the other modules;
- the 30 misleading "No changes" titles;
- the four `window.alert`s.

## Tests run (in the sandbox, against this build)

| Check | Result |
|---|---|
| All guards (`node scripts/run-guards.mjs`) | **210 / 210 pass** |
| Lint | 0 errors, 115 warnings (limit 125) |
| `tests/browser/overflow-sweep.py` | 272 / 272 screens clean |
| `tests/feedback-modal.mjs` (new) | 17 checks, 11 mutations caught |
| `tests/browser/ui-system.py` (adds the Attendance pilot at 1440 and 390) | 347 / 347 |

## Final results

**Browser suites (every one that makes a save, a decision or a submission and then presses the next button):**

| Suite | Result |
|---|---|
| attendance4 | 39 / 39 |
| leave-timeline | 63 / 63 |
| leave4 | 60 / 60 |
| tasks5 | 82 / 82 |
| task-closure | 135 / 135 |
| punch-receipt | 54 / 54 |
| onshift2 | 60 / 60 |
| claims4 | 69 / 69 |
| hr4 | 62 / 62 |
| finance5 | 64 / 64 |
| accounting5 | 37 / 37 |
| sales2 | 44 / 44 |
| tasks2 | 105 / 105 |
| task-progress | 84 / 84 |
| project-workspace | 101 / 101 |
| users-admin | 60 / 60 |

A passive card blocked none of them.

**Adapted, with the intent kept:**
- **action-feedback** and **qt-once:** a decision reports which one it was.
- **card-vocabulary:** a passive card uses the house toast surface.
- **leave-timeline** and **leave4:** the suite now reads the decision's result and checks that "pending" is never "approved", then presses OK.

During the run the sandbox disk filled with the guards' own scratch folders (3,412 of them in /tmp), so the run was repeated after they were removed. Nothing in the product was involved.

## Deployment

Nothing reached production. Run `PUSH.bat` when you choose. There is no migration.
