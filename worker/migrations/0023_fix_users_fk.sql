-- 0023: Fix users foreign key references
--
-- Earlier migrations renamed the `users` table to `_users_old` and recreated
-- `users` from scratch. Because SQLite automatically updates foreign keys on
-- table rename, all 17 child tables were left pointing to `_users_old`.
--
-- We use a rename cascade trick to redirect all foreign keys back to `users`
-- without needing to rebuild all 17 child tables, and without data loss.

ALTER TABLE users RENAME TO users_temp_backup;
ALTER TABLE "_users_old" RENAME TO users;
DROP TABLE users;
ALTER TABLE users_temp_backup RENAME TO users;
