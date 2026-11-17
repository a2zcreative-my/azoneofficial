# GATE 1.342.0 — Sales → Overview: the Sales Pipeline as one row of joined chevrons

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screen only.
**Sits on:** 1.341.2 (the other session's Security & Sessions releases 1.341.0–1.341.2), on the PC.

**Authority:** the CEO, 17-11-2026, with a picture: *"For sales pipeline, please enhance to this styles instead. only for Sales Pipeline"*.

## What changed

**The look:**
- The seven steps join into one row of arrow-shaped steps.
- Each step shows its icon, then the word with the count large under it, then a ">".
- Each step is tinted by its tone with a soft gradient: grey Enquiry; gold Quotation and Follow-Up; blue Invoice and Payment Reported; green CEO Verified and Closed Sale (the strongest).
- The ends of the row are rounded, and a hairline of the card shows between steps.

**Only the Sales Pipeline uses it.** `FlowStrip` gains an `arrows` variant, and `SalesPipeline` is its only user. Every other flow strip is unchanged.

**What stayed the same:**
- **Behaviour:** the same counts and the same press (filter the worklist; CEO Verified and Closed Sale open Closed Sales); Clear works as before.
- **Keyboard and the step in force:** each gets a ring drawn inside the chevron.
- **Phone:** whole steps, scrolling sideways inside the row; the page never scrolls sideways.
- **Theme:** works in dark mode.

## Tests run (sandbox, on this build merged with the PC's 1.340.0; the other session's 1.341.x (sign-in and security) touches none of these files)

| Check | Result |
|---|---|
| All guards (`node scripts/run-guards.mjs`) | **215 / 215 pass** |
| `tests/sales2.mjs` | 36 checks, 17 mutations (3 new checks, 3 new mutations) |
| Lint | 0 errors, 115 warnings (limit 125) |
| Type check | clean |
| sales2 (browser) | 44 / 44 |
| sales4 | 356 / 356 |
| sales-e3 | 33 / 33 |
| tasks2 | 105 / 105 (the other flow strips unchanged) |
| tasks-unified | 112 / 112 |
| kpi-strip-sweep | 660 / 660 |
| overflow sweep | 272 / 272 screens clean |

**Measured at 1280, 1024, 820 and 390 px:**
- no word in a step breaks inside itself;
- every step is at least 176 px wide;
- the page never scrolls sideways.

**Screenshots:** light and dark, the step in force, and the phone.

## Deployment

Nothing reached production. Run `PUSH.bat` when you choose.
