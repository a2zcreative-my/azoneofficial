-- 0186_fa_banker_pic  v1.290.0
-- Financial Advisory banker PIC workspace (image 04, the CEO 12-11-2026).
-- Additive only. CREATE ... IF NOT EXISTS, no ALTER, no DROP, no data written.
-- fa_banker_contact_changes  every change to a banker work email or work phone,
--                            append only - a contact identity verification made
--                            before the latest change no longer counts
-- fa_note_facts              per banker feedback or official decision note - the
--                            day of the contact and the tenure the bank letter states,
--                            written once with the note

CREATE TABLE IF NOT EXISTS fa_banker_contact_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  banker_id INTEGER NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('work_email', 'work_phone')),
  from_value TEXT,
  to_value TEXT,
  changed_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fa_contact_changes_banker
  ON fa_banker_contact_changes (banker_id, id);

CREATE TABLE IF NOT EXISTS fa_note_facts (
  note_id INTEGER PRIMARY KEY,
  contact_on TEXT,
  tenure_months INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS fa_banker_contact_changes_no_update BEFORE UPDATE ON fa_banker_contact_changes
BEGIN SELECT RAISE(ABORT, 'fa_banker_contact_changes is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_banker_contact_changes_no_delete BEFORE DELETE ON fa_banker_contact_changes
BEGIN SELECT RAISE(ABORT, 'fa_banker_contact_changes is append only'); END;

CREATE TRIGGER IF NOT EXISTS fa_note_facts_no_update BEFORE UPDATE ON fa_note_facts
BEGIN SELECT RAISE(ABORT, 'fa_note_facts is written once'); END;

CREATE TRIGGER IF NOT EXISTS fa_note_facts_no_delete BEFORE DELETE ON fa_note_facts
BEGIN SELECT RAISE(ABORT, 'fa_note_facts is written once'); END;
