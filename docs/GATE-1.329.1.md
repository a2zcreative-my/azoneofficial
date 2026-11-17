# GATE 1.329.1 — Tasks → Overview: a long staff name no longer pushes the Staff card's count out

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. CSS only (and the tests that hold it).
**Sits on:** 1.329.0, deployed by the CEO with PUSH.bat on 17-11-2026, 07:16 MYT.

**Authority:** the CEO, 17-11-2026, with a screenshot of Tasks → Overview: *"I saw there is overflow text on the staff cards"*.

## The cause

The Staff Performance list was a CSS grid with no named column, so its column grew to fit its longest row. The Recent Activity list beside it had the same layout.

A long name such as "NURFARAH SUAIDAH BINTI ..." therefore made the row wider than the rail. The count "0 / 9 (0%)" ran past the card's edge, and the rail scrolled sideways (the scrollbar under Weekly Summary).

## The fix

- **The lists name their one column `minmax(0, 1fr)`**, the house rule for every grid (CLAUDE.md, v1.174.1). A long name now shortens with "…" inside its row.
- **Narrow lists use two lines.** Where the list is under 22rem wide, each row shows rank, photo, name and count on the first line and the bar under the name. That covers the rail beside the queue; phones already did this.
- **Other lists:** the row lists in tasks5 (Live Host and the sub-lists) get the same named column.

No figure, rule or route changed.

## Tests

| Check | Result |
|---|---|
| `tests/ui-system.mjs` | 64 checks, 59 mutations (new: the rail's lists name their column and go to two lines when narrow) |
| `tests/browser/ui-system.py` | adds a 40-character name at 1280 px: the rail never scrolls sideways and every count stays inside the card |
| `tests/browser/tasks2.py` | 105 / 105 |
| All guards (`node scripts/run-guards.mjs`) | **210 / 210 pass** |
| `tests/browser/ui-system.py` | 348 / 348 |
| `tests/browser/overflow-sweep.py` | 272 / 272 screens clean |
| `tests/browser/tasks5.py` | 82 / 82 |

## Deployment

Nothing reached production. Run `PUSH.bat` when you choose. There is no migration.
