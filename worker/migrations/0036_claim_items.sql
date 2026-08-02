-- v1.4.95: multi-item claims — one claim form can list several expense
-- lines, matching the paper AZOO-HR-CLM-001 layout. JSON array of
-- {claim_date, category, description, amount_cents}; amount_cents on the
-- claim row stays the TOTAL. Old single-line claims keep working (items NULL).
ALTER TABLE claims ADD COLUMN items TEXT;
