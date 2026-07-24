-- Simple fixed-window rate limiting backed by D1
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,          -- e.g. 'login:1.2.3.4'
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);
