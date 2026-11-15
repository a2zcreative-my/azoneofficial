-- v1.316.0 - ACCOUNTING WORKSPACE 5.0, PHASE B (the CEO, 15-11-2026: approved as
-- per recommendations, then continue the rest - claude/ACCOUNTING-WORKSPACE-5.0-BLUEPRINT.md).
-- A posted journal entry and its lines are kept as posted. A wrong manual
-- entry is corrected by its reversal (REVJ-), a booked one where it came from.
-- No route updates or deletes them, and from this migration the database
-- refuses it too. ADDITIVE ONLY: four triggers, no table, column or row changes.
CREATE TRIGGER IF NOT EXISTS journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'A posted journal entry is kept as posted - reverse it instead'); END;
CREATE TRIGGER IF NOT EXISTS journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'A posted journal entry is kept as posted - reverse it instead'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'A posted journal line is kept as posted - reverse the entry instead'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'A posted journal line is kept as posted - reverse the entry instead'); END;
