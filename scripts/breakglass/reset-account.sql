-- A2Z OS - LEVEL 2 BREAK-GLASS (docs/BREAKGLASS.md). DRAFT - NOT APPROVED FOR USE.
-- Use ONLY under docs/BREAKGLASS.md: the Cloudflare account owner and one witness,
-- physically present, after the in-app executive recovery is impossible.
-- Before running: copy this file, replace every __TARGET_ID__ with the account id,
-- replace __WITNESSED_BY__ with the two full names, compare the SHA-256 of THIS
-- original file with the one recorded in docs/BREAKGLASS.md, then run the copy:
--   npx wrangler d1 execute azoneofficial --remote --file <the copy>
-- It ONLY resets two-factor, ends sessions and marks forced rotation for ONE
-- account, and writes the audit row. It never changes a role, an email, the
-- owner designation, a permission, payroll or finance.
UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_rotation_required = 1 WHERE id = __TARGET_ID__ AND role IN ('ceo', 'super_admin');
DELETE FROM twofa_backup_codes WHERE user_id = __TARGET_ID__;
DELETE FROM twofa_challenges WHERE user_id = __TARGET_ID__;
DELETE FROM sessions WHERE user_id = __TARGET_ID__;
UPDATE account_tokens SET used_at = datetime('now') WHERE user_id = __TARGET_ID__ AND used_at IS NULL;
UPDATE oauth_requests SET used_at = datetime('now') WHERE user_id = __TARGET_ID__ AND used_at IS NULL;
INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (NULL, 'auth.breakglass', 'users', '__TARGET_ID__', '{"witnessed_by":"__WITNESSED_BY__","script":"scripts/breakglass/reset-account.sql"}');
