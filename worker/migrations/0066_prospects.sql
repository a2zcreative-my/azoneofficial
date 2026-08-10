-- v1.4.267 — the prospect pipeline (CEO: "something that may approach my
-- potential customer in Malaysia which is easier for me to get my team
-- approach them… make a new tabs under Social").
--
-- Leads found on TikTok/Shopee/Instagram/expos die in WhatsApp screenshots;
-- this table is where they live instead. No FOREIGN KEYS (house rule since
-- the v1.4.69 incident) — assigned_to / created_by reference users.id by
-- convention and are joined with LEFT JOIN.

CREATE TABLE prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'tiktok',          -- tiktok|shopee|instagram|facebook|expo|referral|other
  niche TEXT,                                     -- e.g. hijab, skincare, F&B
  contact_name TEXT,
  contact_channel TEXT,                           -- whatsapp|dm|email|phone
  contact_value TEXT,                             -- the number / handle / address itself
  notes TEXT,
  stage TEXT NOT NULL DEFAULT 'identified',       -- identified|contacted|replied|meeting|proposal|won|lost
  assigned_to INTEGER,
  next_followup TEXT,                             -- YYYY-MM-DD (MYT calendar day)
  followup_notified_on TEXT,                      -- dedupe: last date the reminder fired
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  stage_changed_at TEXT
);

CREATE INDEX idx_prospects_stage ON prospects(stage);
CREATE INDEX idx_prospects_followup ON prospects(next_followup);
