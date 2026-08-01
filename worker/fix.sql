PRAGMA foreign_keys = OFF;
ALTER TABLE users RENAME TO users_temp_backup;
ALTER TABLE "_users_old" RENAME TO users;
DROP TABLE users;
ALTER TABLE users_temp_backup RENAME TO users;
PRAGMA foreign_keys = ON;
