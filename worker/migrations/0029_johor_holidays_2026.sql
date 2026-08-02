-- v1.4.81: Johor 2026 public holidays, seeded from the official state
-- gazette (johor.gov.my "Cuti Umum Johor 2026", circular dated 10 Dec 2025),
-- plus replacement days per COMPANY policy: a holiday falling on Saturday or
-- Sunday is replaced on Monday (or the next free working day when Monday is
-- itself a holiday). Note the official state rule replaces SUNDAY only —
-- the company policy is more generous by also replacing Saturdays; delete a
-- replacement row in HR → holidays to follow the gazette instead.
INSERT OR IGNORE INTO holidays (holiday_date, name, kind, created_by) VALUES
  ('2026-02-01', 'Hari Thaipusam', 'public', NULL),
  ('2026-02-17', 'Tahun Baru Cina', 'public', NULL),
  ('2026-02-18', 'Tahun Baru Cina (Hari Kedua)', 'public', NULL),
  ('2026-02-19', 'Awal Ramadhan', 'public', NULL),
  ('2026-03-21', 'Hari Raya Puasa', 'public', NULL),
  ('2026-03-22', 'Hari Raya Puasa (Hari Kedua)', 'public', NULL),
  ('2026-03-23', 'Hari Keputeraan DYMM Sultan Johor', 'public', NULL),
  ('2026-05-01', 'Hari Pekerja', 'public', NULL),
  ('2026-05-27', 'Hari Raya Qurban', 'public', NULL),
  ('2026-05-31', 'Hari Wesak', 'public', NULL),
  ('2026-06-01', 'Hari Keputeraan YDP Agong', 'public', NULL),
  ('2026-06-17', 'Awal Muharram (Ma''al Hijrah)', 'public', NULL),
  ('2026-07-21', 'Hari Hol Almarhum Sultan Iskandar', 'public', NULL),
  ('2026-08-25', 'Maulidur Rasul', 'public', NULL),
  ('2026-08-31', 'Hari Kebangsaan', 'public', NULL),
  ('2026-09-16', 'Hari Malaysia', 'public', NULL),
  ('2026-11-08', 'Hari Deepavali', 'public', NULL),
  ('2026-12-25', 'Hari Krismas', 'public', NULL),
  -- Replacements (company Sat/Sun rule, chronological assignment):
  ('2026-02-02', 'Hari Thaipusam (Replacement)', 'replacement', NULL),
  ('2026-03-24', 'Hari Raya Puasa (Replacement)', 'replacement', NULL),
  ('2026-03-25', 'Hari Raya Puasa Hari Kedua (Replacement)', 'replacement', NULL),
  ('2026-06-02', 'Hari Wesak (Replacement)', 'replacement', NULL),
  ('2026-11-09', 'Hari Deepavali (Replacement)', 'replacement', NULL);
