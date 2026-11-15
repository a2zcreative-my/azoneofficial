# GATE 1.318.0 — On Shift: the clock-in / clock-out confirmation, and the company's own logo

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only; the worker is unchanged.

**Authority:** the CEO, 15-11-2026, with a picture: "update for clock in and clock out when staff click the button. make sure it is fit with PWA", then "A2Z OS change to my own logo. make it standardize".

## What changed

### While the punch is on its way
- A card over the page: the company's logo, a turning ring, "Recording attendance… Please wait a moment."

### When the server has recorded it
- A confirmation sheet, as the picture:
  - the tick and **Clock-In Recorded!** (green) or **Clock-Out Recorded!** (gold);
  - the date, and the time in Malaysia time;
  - the shift and its hours (clock-in), or the total hours (clock-out);
  - the place: Within / Outside Geofence with the distance;
  - who recorded it, and **Done**.
- Done, the X, the backdrop and Escape all close it.

### Nothing on the sheet is a new fact
| On the sheet | Where it comes from |
|---|---|
| Time | The server's own record of the punch, read back |
| Place and distance | That record's location outcome — the same one the register shows |
| "Tagged for HR" | The one existing rule: outside or no location; never the CEO, COO or CCO |
| Total hours | The day's worked sessions — the shift timer's figure |
| Shift and hours | The schedule the server judged the punch by |

- A late clock-in keeps its verdict ("Marked late").
- Overtime that a clock-out measured is said on the same sheet. It used to follow as a second pop-up.

### Only a clean punch opens it
A punch that is waiting for the CEO, kept on the phone with no signal, or refused is not "recorded". Those keep the words they have always had.

### The logo
- The picture showed a drawn gold "A" beside "A2Z OS". Both cards now carry **your own logo** (`public/logo.png`, the mark the side rail already shows), with "Attendance" beside it.
- It is drawn by one new shared piece, `components/ui/brand-logo.tsx`, so any future dialog that names the company shows the same mark.
- **Not changed:** the "A2Z OS" wordmark at the top of the side rail. Say if you want that replaced with the logo too.

### PWA
- **Phone:** a bottom sheet, full width, with the home-indicator inset under Done; 44 px targets; it scrolls inside itself on a short screen.
- **640 px and wider:** a centred card.
- Reduced-motion settings are respected.

## Evidence (executed in the sandbox)
- **`tests/punch-receipt.mjs` (new, registered): 17 checks; all 11 deliberately broken versions were caught.**
- **`tests/browser/punch-receipt.py` (new): 50/50.** Clock-in and clock-out as the CEO at 1440 px and as a live host at 390 px; the sheet at 320, 360 and 430 px; a refused punch shows no sheet.
- **Full run (after the last change, together with 1.317.0): 204 of 204 guards passed.** TypeScript clean; lint 0 errors.

## Known limit of the test data
- `tests/browser/onshift2.py` showed 61 of 65 today.
- The four that failed all need a punch recorded today. The test data makes every Sunday a rest day with no punch, and today (15-11-2026) is a Sunday. I confirmed that in the test data itself.
- I have not re-run it on a weekday, so "it passes on other days" is expected, not yet shown.

## Deploy notes
- No migration and no worker change.
- **After deploying:** staff see the new card and sheet the next time they clock in or out. Nothing else on On Shift moves.

## Rollback
- Re-run PUSH.bat from the 1.317.0 files. No data was touched.
