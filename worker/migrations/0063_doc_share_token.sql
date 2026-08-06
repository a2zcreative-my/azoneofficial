-- v1.4.244 — send a document to the customer from a phone.
--
-- share_token is a long random string minted on demand. While it is set, the
-- document is readable at /doc?t=<token> with no sign-in, which is what makes
-- it shareable through WhatsApp. Clearing the column revokes the link
-- instantly. NULL = never shared.
--
-- No foreign keys (v1.4.69 incident); nullable, so every existing document is
-- untouched and simply has no link until someone presses Share.

ALTER TABLE sales_documents ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_share_token ON sales_documents(share_token);
