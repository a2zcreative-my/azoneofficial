-- 0086 — v1.45.0 (security audit C6): a used two-factor code cannot be used
-- again.
--
-- TOTP codes are valid for a ~90-second window (the current 30-second step
-- plus one either side, so a slow clock still works). Nothing recorded which
-- codes had already been spent, so a code seen over someone's shoulder — or
-- read off a screen share, or captured in a support log — stayed usable for
-- the rest of that window.
--
-- `totp_last_step` stores the highest 30-second step already accepted for
-- this user. A verification must present a step ABOVE it, so every code is
-- good exactly once and replay has nothing to work with. NULL = nobody has
-- verified yet, which accepts any step in the window (the first use).
--
-- Single ALTER, nothing else in this file (audit B4 rule: one non-idempotent
-- statement per migration — a half-apply is a no-apply).

ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
